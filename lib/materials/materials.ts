import type { Activity, MaterialRef } from "../types";
import { catalogNameFor, type Material } from "./materialCatalog";
import { isStocked, type StockState } from "./kitStock";
import { materialTagId } from "./materialTag";

export interface MaterialOption {
  id: string;
  label: string;
  count: number;
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

export function materialTagsFromMaterials(materials: string[]): string[] {
  return unique(materials.map(materialTagId).filter(Boolean));
}

function stringTags(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
}

function refArray(values: unknown): MaterialRef[] {
  if (!Array.isArray(values)) return [];
  return values.filter(
    (value): value is MaterialRef =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { id?: unknown }).id === "string"
  );
}

// "No materials", "No materials needed", "None" — sentinel labels that mean the
// activity needs nothing. They must never read as a real kit item, so they're
// kept out of the picker and out of the set a kit filter matches against.
function isNoMaterialsId(id: string): boolean {
  return id === "none" || id.startsWith("no-material");
}

// A resolved need: the join-key id, a human label, and an optional per-placement
// note. `label` is what the UI shows; `id` is what the on-hand set/filter match.
export interface ResolvedRef {
  id: string;
  label: string;
  note?: string;
}

// THE single needs accessor. Resolves an activity's kit into ordered, deduped
// { id, label, note? } rows with a strict three-tier precedence:
//
//   1. materialRefs (canonical) — id used directly, label via the catalog
//      (catalogNameFor falls back to a humanized slug when the id is unknown,
//      so a lazily-populated catalog still renders), note carried through.
//   2. materialTags (curated) — whole string, id = materialTagId(tag),
//      label = tag. Compact tag vocabulary ("Flags", not "2 flags").
//   3. materials (free text) — whole string, id = materialTagId(string),
//      label = the trimmed string. NO comma splitting: "Flour, ~2 cups" is ONE
//      need, not three (killing the round-trip fragmentation bug).
//
// Only the first non-empty tier is used (refs win over tags win over free text),
// matching the legacy materialTags-over-materials precedence but adding refs on
// top. The "No materials" sentinel is filtered in EVERY tier, and rows are
// deduped by id in first-seen order.
export function resolveRefs(activity: Activity, catalog?: Material[]): ResolvedRef[] {
  const seen = new Set<string>();
  const out: ResolvedRef[] = [];
  const push = (id: string, label: string, note?: string) => {
    if (!id || isNoMaterialsId(id) || seen.has(id)) return;
    seen.add(id);
    out.push(note ? { id, label, note } : { id, label });
  };

  const refs = refArray(activity.materialRefs);
  if (refs.length) {
    refs.forEach((ref) => {
      const id = materialTagId(ref.id);
      const note = typeof ref.note === "string" ? compact(ref.note) : "";
      push(id, catalogNameFor(catalog, id), note || undefined);
    });
    return out;
  }

  const tags = stringTags(activity.materialTags);
  if (tags.length) {
    tags.forEach((tag) => push(materialTagId(tag), compact(tag)));
    return out;
  }

  stringTags(activity.materials).forEach((raw) => push(materialTagId(raw), compact(raw)));
  return out;
}

// The kit an activity genuinely needs, as join-key ids. Reimplemented on top of
// resolveRefs so all three tiers + sentinel filtering + dedupe stay in one place
// (the catalog isn't needed — ids are the same regardless of labels).
export function requiredMaterialTagIds(activity: Activity): string[] {
  return resolveRefs(activity).map((ref) => ref.id);
}

export interface MaterialNeed {
  id: string;
  label: string;
}

// One row per distinct material an activity needs, in authored order, with a
// human label. Ids match the global "materials I have" set, so the detail-view
// checklist and the library "Available kit" filter stay in sync. A thin view
// over resolveRefs (drops the note — existing consumers only want id + label).
export function materialNeedsForActivity(activity: Activity, catalog?: Material[]): MaterialNeed[] {
  return resolveRefs(activity, catalog).map((ref) => ({ id: ref.id, label: ref.label }));
}

// The global kit vocabulary: every distinct material id across the catalog, with
// a first-seen label and per-activity usage count, sorted by label. Built on
// resolveRefs so it uses the SAME three-tier precedence + sentinel filtering the
// checklist does (a curated tag and a free-text label collapse to one id). An
// optional catalog gives ref-tier entries their proper display name.
export function materialOptionsForActivities(
  activities: Activity[],
  catalog?: Material[]
): MaterialOption[] {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();

  activities.forEach((activity) => {
    const activityIds = new Set<string>();
    resolveRefs(activity, catalog).forEach((ref) => {
      if (!labels.has(ref.id)) labels.set(ref.id, ref.label);
      activityIds.add(ref.id);
    });
    activityIds.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  });

  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: labels.get(id) || id, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// The library "Available kit" filter is an OR across the picked items: an
// activity matches when it uses ANY selected material, so ticking "Balloons"
// surfaces every balloon activity — mirroring each item's count badge and the
// Type/Where/Ages/Themes filters. No selection means no filtering.
export function usesAnyMaterialTag(activity: Activity, selectedMaterialTagIds: string[]): boolean {
  if (!selectedMaterialTagIds.length) return true;
  const selected = new Set(selectedMaterialTagIds);
  return requiredMaterialTagIds(activity).some((id) => selected.has(id));
}

// ---------------------------------------------------------------------------
// Coverage — the availability lens over the 3-state kit stock.
//
// A "state" summary of whether the camp can run an activity right now given
// what's on hand (the effectiveKitStock map, material id → have/low/out):
//   · unset  — the stock map is empty ({}): nobody has reviewed inventory, so
//              the lens is INERT (no green/amber/red anywhere). This is what a
//              fresh account sees.
//   · ready  — every need is covered (a need with 0 uncovered items).
//   · almost — exactly ONE need is uncovered (a single trip to the cupboard).
//   · cant   — two or more needs are uncovered.
//
// A need is covered when its own id is stocked (have|low), OR any of its catalog
// entry's `substitutes` is stocked (recorded in `substituted` so the UI can say
// "↔ via <name>"). "out" and absent both read as uncovered. Zero-needs activities
// are ALWAYS "ready" (nothing to gather). `lowCount` counts needs covered by a
// "low" item — a decoration (amber accent) that never demotes the state.
// ---------------------------------------------------------------------------
type CoverageState = "unset" | "ready" | "almost" | "cant";

export interface Coverage {
  state: CoverageState;
  missing: { id: string; label: string }[];
  lowCount: number;
  substituted: { id: string; viaId: string }[];
}

export function coverage(
  activity: Activity,
  stock: Record<string, StockState>,
  catalog?: Material[]
): Coverage {
  const needs = resolveRefs(activity, catalog);
  // Zero needs always run — nothing to gather, so the stock state is irrelevant.
  if (!needs.length) {
    return { state: "ready", missing: [], lowCount: 0, substituted: [] };
  }
  // An empty stock map is the UNSET signal: the lens stays inert (no can-run
  // verdict). Callers treat "unset" as "don't decorate / pass everything".
  if (Object.keys(stock).length === 0) {
    return { state: "unset", missing: [], lowCount: 0, substituted: [] };
  }

  // Substitution groups are keyed by id in the catalog; index them once so a
  // need can check whether any of its stand-ins is on hand.
  const substitutesById = new Map<string, string[]>();
  if (catalog) {
    for (const entry of catalog) {
      if (entry.substitutes?.length) substitutesById.set(entry.id, entry.substitutes);
    }
  }

  const missing: { id: string; label: string }[] = [];
  const substituted: { id: string; viaId: string }[] = [];
  let lowCount = 0;

  for (const need of needs) {
    const own = stock[need.id];
    if (isStocked(own)) {
      if (own === "low") lowCount += 1;
      continue;
    }
    // Own item is out/absent — try substitutes (a "low" stand-in still counts,
    // and decorates the same way a low own-item would).
    const subs = substitutesById.get(need.id) ?? [];
    const viaId = subs.find((sub) => isStocked(stock[sub]));
    if (viaId) {
      substituted.push({ id: need.id, viaId });
      if (stock[viaId] === "low") lowCount += 1;
      continue;
    }
    missing.push({ id: need.id, label: need.label });
  }

  const uncovered = missing.length;
  const state: CoverageState = uncovered === 0 ? "ready" : uncovered === 1 ? "almost" : "cant";
  return { state, missing, lowCount, substituted };
}

