// The materials catalog — the single source of truth that reconciles the two
// lists a counselor cares about:
//   • "Available kit"  = catalog items flagged ON HAND (a separate per-user set,
//                        the existing `availableMaterials` doc, holding catalog ids).
//   • "Required"       = catalog items an activity references (its `materialRefs`,
//                        or, for un-migrated activities, derived from materialTags).
// They are not two stored lists kept in sync — they are two facets of ONE catalog
// joined by `activity.materialRefs → Material.id`. Substitution lives here too, so
// "a particular ball" is satisfied by ANY ball on hand, authored once (a category)
// rather than per activity.
//
// This module is pure (no persistence, no React): the coverage predicate, the
// catalog<->activity helpers, and the build-time/runtime curation merge. Persistence
// + UI wiring sit on top of it.

import type { Activity } from "./types";
import { materialTagId, materialOptionsForActivities, requiredMaterialTagIds } from "./materials";

// ---- Types ----------------------------------------------------------------

/** A canonical, atomic material. `id` is a materialTagId() slug so it stays
 *  stable across rebuilds AND lines up with the legacy `availableMaterials` set. */
export interface Material {
  id: string;
  name: string;
  aliases?: string[];
  /** A MaterialCategory id. A category doubles as a substitution class: any
   *  on-hand member of the category can stand in for another member. */
  category?: string;
  /** Explicit cross-item stand-ins (e.g. egg.substitutes = ["ping-pong-ball"]). */
  substitutes?: string[];
}

export interface MaterialCategory {
  id: string;
  label: string;
}

export interface MaterialCatalog {
  materials: Material[];
  categories: MaterialCategory[];
}

/** One requirement an activity places on the kit. `item` needs THIS material (or
 *  a substitute / same-category swap); `category` needs ANY member of a class;
 *  `other` is an unmapped free-text atom that degrades to an honest "Need". */
export type MaterialRef =
  | { kind: "item"; id: string; optional?: boolean }
  | { kind: "category"; id: string; optional?: boolean }
  | { kind: "other"; label: string; optional?: boolean };

export interface CoverageResult {
  /** Every non-optional requirement is satisfiable from what's on hand. */
  runnable: boolean;
  missing: MaterialRef[];
  missingLabels: string[];
  /** Requirements covered by a NON-identity match (a real substitution) — the
   *  "use your Y instead" rows on the run sheet. */
  satisfiedBySubstitute: Array<{ ref: MaterialRef; via: string; viaLabel: string }>;
  /** Count of non-optional requirements (for "Have N · Need M"). */
  total: number;
}

export type RunnableState = "ready" | "almost" | "blocked";

// ---- Catalog index (memoize at the call site) -----------------------------

export interface CatalogIndex {
  byId: Map<string, Material>;
  categoryById: Map<string, MaterialCategory>;
  membersByCategory: Map<string, string[]>;
}

export function indexCatalog(catalog: MaterialCatalog): CatalogIndex {
  const byId = new Map<string, Material>();
  const categoryById = new Map<string, MaterialCategory>();
  const membersByCategory = new Map<string, string[]>();
  for (const c of catalog.categories) categoryById.set(c.id, c);
  for (const m of catalog.materials) {
    byId.set(m.id, m);
    if (m.category) {
      const arr = membersByCategory.get(m.category) ?? [];
      arr.push(m.id);
      membersByCategory.set(m.category, arr);
    }
  }
  return { byId, categoryById, membersByCategory };
}

export function refLabel(ref: MaterialRef, index: CatalogIndex): string {
  if (ref.kind === "other") return ref.label;
  if (ref.kind === "category") return index.categoryById.get(ref.id)?.label ?? ref.id;
  return index.byId.get(ref.id)?.name ?? ref.id;
}

function materialLabel(id: string, index: CatalogIndex): string {
  return index.byId.get(id)?.name ?? id;
}

// ---- Coverage predicate (ALL-covered, substitution-aware) -----------------
//
// REPLACES the OR-based usesAnyMaterialTag ("show me anything that uses cones").
// This asks the runnability question instead: "can I run ALL of this?".

interface RefCover {
  ok: boolean;
  /** The on-hand material id that satisfied it (for the "via" / substitute UI). */
  via?: string;
  /** True when `via` is a substitution rather than the exact requested item. */
  substituted?: boolean;
}

function coverRef(ref: MaterialRef, onHand: ReadonlySet<string>, index: CatalogIndex): RefCover {
  if (ref.kind === "other") {
    // Unmapped atom: never silently runnable. Optional ones don't block; the
    // rest stay an honest "Need" the user resolves by hand.
    return { ok: Boolean(ref.optional) };
  }
  if (ref.kind === "category") {
    // An "any of these" requirement (e.g. "flags or pinnies"): having a NAMED
    // member is plain coverage, not a stand-in. So `substituted` stays false —
    // the "↔ substitution" signal is reserved for item refs met by a swap.
    const members = index.membersByCategory.get(ref.id) ?? [];
    const hit = members.find((id) => onHand.has(id));
    return hit ? { ok: true, via: hit, substituted: false } : { ok: false };
  }
  // item: direct hit, then declared substitutes, then any same-category swap.
  if (onHand.has(ref.id)) return { ok: true, via: ref.id, substituted: false };
  const mat = index.byId.get(ref.id);
  const sub = (mat?.substitutes ?? []).find((id) => onHand.has(id));
  if (sub) return { ok: true, via: sub, substituted: true };
  if (mat?.category) {
    const swap = (index.membersByCategory.get(mat.category) ?? []).find(
      (id) => id !== ref.id && onHand.has(id)
    );
    if (swap) return { ok: true, via: swap, substituted: true };
  }
  return { ok: false };
}

export function materialCoverage(
  refs: MaterialRef[],
  onHand: ReadonlySet<string>,
  index: CatalogIndex
): CoverageResult {
  const missing: MaterialRef[] = [];
  const satisfiedBySubstitute: CoverageResult["satisfiedBySubstitute"] = [];
  let total = 0;
  for (const ref of refs) {
    if (ref.optional) continue;
    total += 1;
    const cover = coverRef(ref, onHand, index);
    if (!cover.ok) {
      missing.push(ref);
      continue;
    }
    if (cover.substituted && cover.via) {
      satisfiedBySubstitute.push({ ref, via: cover.via, viaLabel: materialLabel(cover.via, index) });
    }
  }
  return {
    runnable: missing.length === 0,
    missing,
    missingLabels: missing.map((r) => refLabel(r, index)),
    satisfiedBySubstitute,
    total,
  };
}

/** The 3-state bucket the "can I run this" filter uses. Runnable (even if only
 *  via substitutes) is Ready — you CAN run it. Almost = 1–2 short; the rest Can't. */
export function runnableState(cover: CoverageResult): RunnableState {
  if (cover.runnable) return "ready";
  if (cover.missing.length <= 2) return "almost";
  return "blocked";
}

// ---- Activity → refs (with un-migrated fallback) ---------------------------

/** Refs for an activity that has no `materialRefs` yet: exact-match item refs
 *  derived from its (de-sentinel'd, deduped) materialTags. Zero-backfill compat. */
export function legacyRefsFromTags(activity: Activity): MaterialRef[] {
  return requiredMaterialTagIds(activity).map((id) => ({ kind: "item", id } as MaterialRef));
}

/** The canonical requirement list for an activity. Prefers authored
 *  `materialRefs`; falls back to legacy tag-derived item refs. */
export function refsForActivity(activity: Activity): MaterialRef[] {
  const refs = (activity as { materialRefs?: MaterialRef[] }).materialRefs;
  return refs && refs.length ? refs : legacyRefsFromTags(activity);
}

/** A coverage-aware row per requirement — what the run-sheet materials block
 *  renders (have ✓ / substitute ↔ / missing ⚠). */
export interface MaterialRow {
  ref: MaterialRef;
  label: string;
  status: "have" | "substitute" | "missing";
  /** For a substitute row: the on-hand item to use instead. */
  substituteLabel?: string;
  optional?: boolean;
}

export function materialRowsForActivity(
  activity: Activity,
  onHand: ReadonlySet<string>,
  index: CatalogIndex
): MaterialRow[] {
  return refsForActivity(activity).map((ref) => {
    const cover = coverRef(ref, onHand, index);
    const label = refLabel(ref, index);
    if (!cover.ok) return { ref, label, status: "missing", optional: ref.optional };
    if (cover.substituted && cover.via) {
      return {
        ref,
        label,
        status: "substitute",
        substituteLabel: materialLabel(cover.via, index),
        optional: ref.optional,
      };
    }
    return { ref, label, status: "have", optional: ref.optional };
  });
}

/** Back-references: for every material id, the activities that require it (via
 *  an item ref, or a category ref whose class the material belongs to). Powers
 *  the Materials view's "Required by N" expansion. */
export function backReferences(
  activities: Activity[],
  index: CatalogIndex
): Map<string, Activity[]> {
  const out = new Map<string, Activity[]>();
  const push = (id: string, a: Activity) => {
    const arr = out.get(id) ?? [];
    if (!arr.includes(a)) arr.push(a);
    out.set(id, arr);
  };
  for (const activity of activities) {
    for (const ref of refsForActivity(activity)) {
      if (ref.kind === "item") push(ref.id, activity);
      else if (ref.kind === "category") {
        for (const memberId of index.membersByCategory.get(ref.id) ?? []) push(memberId, activity);
      }
    }
  }
  return out;
}

// ---- Curation merge (build-time + the draft harness share this) -----------

/** The hand-authored substitution layer (lib/seed/material-curation.json):
 *  categories (substitution classes), per-material category/substitute links,
 *  and the dozen real "X or Y" tags that should resolve to a category. */
export interface MaterialCuration {
  categories?: MaterialCategory[];
  materials?: Record<string, { category?: string; substitutes?: string[]; name?: string; aliases?: string[] }>;
  /** A bundled tag id ("flags-or-pinnies") → the category its members form. The
   *  bundle is removed from the catalog; refs to it become a category ref. */
  splitBundles?: Record<string, { category: string; categoryLabel: string; members: Array<{ id: string; name: string }> }>;
}

/** Derive the flat base catalog from the library's existing material tags. */
export function baseMaterialsFromActivities(activities: Activity[]): Material[] {
  return materialOptionsForActivities(activities).map((option) => ({ id: option.id, name: option.label }));
}

/** Build the curated catalog from the activity library, and a `refsFor` that maps
 *  each activity's tags to refs (remapping bundles to category refs). Used by the
 *  draft harness now and by the build-seed pipeline in production. */
export function buildCatalogFromActivities(
  activities: Activity[],
  curation: MaterialCuration = {}
): { catalog: MaterialCatalog; refsFor: (activity: Activity) => MaterialRef[] } {
  // 1. Base materials, keyed for in-place edits.
  const byId = new Map<string, Material>();
  for (const option of materialOptionsForActivities(activities)) {
    byId.set(option.id, { id: option.id, name: option.label });
  }
  const categories = new Map<string, MaterialCategory>();
  for (const c of curation.categories ?? []) categories.set(c.id, c);

  // 2. Per-material curation (category / substitutes / name).
  for (const [id, spec] of Object.entries(curation.materials ?? {})) {
    const mat = byId.get(id) ?? { id, name: spec.name ?? id };
    if (spec.name) mat.name = spec.name;
    if (spec.aliases) mat.aliases = spec.aliases;
    if (spec.category) mat.category = spec.category;
    if (spec.substitutes) mat.substitutes = spec.substitutes;
    byId.set(id, mat);
  }

  // 3. Split bundles: drop the bundle "material", add its members under a shared
  //    category, and record the remap so refs to the bundle become category refs.
  const bundleRemap = new Map<string, string>();
  for (const [bundleId, spec] of Object.entries(curation.splitBundles ?? {})) {
    byId.delete(bundleId);
    bundleRemap.set(bundleId, spec.category);
    if (!categories.has(spec.category)) categories.set(spec.category, { id: spec.category, label: spec.categoryLabel });
    for (const member of spec.members) {
      const mat = byId.get(member.id) ?? { id: member.id, name: member.name };
      // Don't clobber a richer category already assigned to a real material.
      if (!mat.category) mat.category = spec.category;
      byId.set(member.id, mat);
    }
  }

  const catalog: MaterialCatalog = {
    materials: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
    categories: [...categories.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };

  const refsFor = (activity: Activity): MaterialRef[] =>
    requiredMaterialTagIds(activity).map((tagId) => {
      const remapped = bundleRemap.get(tagId);
      if (remapped) return { kind: "category", id: remapped } as MaterialRef;
      if (byId.has(tagId)) return { kind: "item", id: tagId } as MaterialRef;
      return { kind: "other", label: tagId } as MaterialRef;
    });

  return { catalog, refsFor };
}

// ---- Pure catalog mutations (used by the useActivityLibrary hooks) ---------

export function cloneCatalog(catalog: MaterialCatalog): MaterialCatalog {
  return {
    materials: catalog.materials.map((m) => ({ ...m, aliases: m.aliases ? [...m.aliases] : undefined, substitutes: m.substitutes ? [...m.substitutes] : undefined })),
    categories: catalog.categories.map((c) => ({ ...c })),
  };
}

function sortByName<T extends { name?: string; label?: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (a.name ?? a.label ?? "").localeCompare(b.name ?? b.label ?? ""));
}

/** Add a material from a typed name. Returns the catalog unchanged if blank or a
 *  duplicate id. */
export function addMaterialToCatalog(catalog: MaterialCatalog, name: string): MaterialCatalog {
  const trimmed = name.trim();
  const id = materialTagId(trimmed);
  if (!id || catalog.materials.some((m) => m.id === id)) return catalog;
  return { ...catalog, materials: sortByName([...catalog.materials, { id, name: trimmed }]) };
}

export function renameMaterialInCatalog(catalog: MaterialCatalog, id: string, name: string): MaterialCatalog {
  const trimmed = name.trim();
  if (!trimmed) return catalog;
  return { ...catalog, materials: sortByName(catalog.materials.map((m) => (m.id === id ? { ...m, name: trimmed } : m))) };
}

export function setMaterialCategory(catalog: MaterialCatalog, id: string, category: string | null): MaterialCatalog {
  return {
    ...catalog,
    materials: catalog.materials.map((m) => {
      if (m.id !== id) return m;
      const next = { ...m };
      if (category) next.category = category;
      else delete next.category;
      return next;
    }),
  };
}

export function addSubstituteToMaterial(catalog: MaterialCatalog, id: string, subId: string): MaterialCatalog {
  if (id === subId || !catalog.materials.some((m) => m.id === subId)) return catalog;
  return {
    ...catalog,
    materials: catalog.materials.map((m) =>
      m.id === id ? { ...m, substitutes: [...new Set([...(m.substitutes ?? []), subId])] } : m
    ),
  };
}

export function removeSubstituteFromMaterial(catalog: MaterialCatalog, id: string, subId: string): MaterialCatalog {
  return {
    ...catalog,
    materials: catalog.materials.map((m) =>
      m.id === id ? { ...m, substitutes: (m.substitutes ?? []).filter((x) => x !== subId) } : m
    ),
  };
}

/** Create a category from a label. Returns the new catalog and the new id (or the
 *  existing id if a category with that slug already exists). */
export function createCategoryInCatalog(catalog: MaterialCatalog, label: string): { catalog: MaterialCatalog; id: string } {
  const trimmed = label.trim();
  const id = materialTagId(trimmed);
  if (!id) return { catalog, id: "" };
  if (catalog.categories.some((c) => c.id === id)) return { catalog, id };
  return { catalog: { ...catalog, categories: sortByName([...catalog.categories, { id, label: trimmed }]) }, id };
}

/** Delete a material — also purge it from on-hand callers, every substitute list,
 *  and leave dangling category refs harmless (handled by the validator). */
export function deleteMaterialFromCatalog(catalog: MaterialCatalog, id: string): MaterialCatalog {
  return {
    ...catalog,
    materials: catalog.materials
      .filter((m) => m.id !== id)
      .map((m) => (m.substitutes?.includes(id) ? { ...m, substitutes: m.substitutes.filter((x) => x !== id) } : m)),
  };
}

// ---- Validator (client + server, mirrors normalizeThemes / locations) ------

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && Boolean(v)) : [];
}

/** Sanitize a stored/incoming catalog: coerce ids to slugs, dedupe, and drop
 *  references (category, substitutes) to ids that don't exist. */
export function normalizeMaterialCatalog(value: unknown, fallback: MaterialCatalog): MaterialCatalog {
  if (!value || typeof value !== "object") return fallback;
  const v = value as { materials?: unknown; categories?: unknown };
  if (!Array.isArray(v.materials) || !Array.isArray(v.categories)) return fallback;

  const categories: MaterialCategory[] = [];
  const seenCat = new Set<string>();
  for (const raw of v.categories) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { id?: unknown; label?: unknown };
    const id = typeof c.id === "string" ? materialTagId(c.id) : "";
    const label = typeof c.label === "string" ? c.label.trim() : "";
    if (!id || !label || seenCat.has(id)) continue;
    seenCat.add(id);
    categories.push({ id, label });
  }

  const materials: Material[] = [];
  const seenMat = new Set<string>();
  for (const raw of v.materials) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as { id?: unknown; name?: unknown; aliases?: unknown; category?: unknown; substitutes?: unknown };
    const id = typeof m.id === "string" ? materialTagId(m.id) : "";
    const name = typeof m.name === "string" ? m.name.trim() : "";
    if (!id || !name || seenMat.has(id)) continue;
    seenMat.add(id);
    const mat: Material = { id, name };
    const aliases = asStringArray(m.aliases);
    if (aliases.length) mat.aliases = aliases;
    if (typeof m.category === "string" && seenCat.has(materialTagId(m.category))) mat.category = materialTagId(m.category);
    const substitutes = asStringArray(m.substitutes).map(materialTagId);
    if (substitutes.length) mat.substitutes = substitutes;
    materials.push(mat);
  }

  // Second pass: drop substitute refs to ids that don't exist as materials.
  const ids = new Set(materials.map((m) => m.id));
  for (const mat of materials) {
    if (mat.substitutes) {
      const kept = mat.substitutes.filter((s) => s !== mat.id && ids.has(s));
      if (kept.length) mat.substitutes = [...new Set(kept)];
      else delete mat.substitutes;
    }
  }

  return { materials, categories };
}
