// Shared activity-form model + save/extract logic for the unified create/edit
// surface. Lifted VERBATIM out of the old AddView form so the produced Activity
// + runLists override keep exactly the same shape — existing saved data still
// loads. The unified DetailSheet imports the FormState model, the field-control
// helpers (parsers/derivation), and the save-path scaffold logic from here so
// there is one source of truth for how a scalar property becomes Activity data.

import type { Activity, AgeGroupId, CategoryId, MaterialRef, Place, Prep } from "./types";
import { AGE_GROUPS } from "./data";
import { normalizeHexColor } from "./color";
import { materialNeedsForActivity, materialTagId, resolveRefs } from "./materials";
import { type Material } from "./materialCatalog";
import {
  buildRunDoc,
  cloneRunDoc,
  detailsBlock,
  detailsHeadingBlock,
  materialsBlock,
  playHeadingBlock,
  runId,
  type RunBlock,
  type RunChild,
  type RunDoc,
} from "./runList";
import { MAX_ACTIVITY_DURATION_MIN as TOTAL_MIN } from "./calendar/time";

export type EnergyWord = "Calm" | "Lively" | "Rowdy";

// One editable kit row in the form. `id` is the materialTagId join key; `label`
// is the display/typed text (the mirror the empty catalog reads back on reload);
// `note` is an optional qty/detail. `minted` marks a row created THIS session
// from a typed name — those re-slug their id when renamed, whereas a row that
// came from storage keeps its frozen id and a rename only changes the label.
export interface MaterialFormRow {
  id: string;
  label: string;
  note?: string;
  minted?: boolean;
}

// Snapshot of an activity's material fields at seed time — form-internal
// provenance (NOT activity data). Lets activityFromForm detect "the rows didn't
// change" and carry the ORIGINAL materials/materialTags/materialRefs through
// byte-for-byte, so opening + saving an untouched activity is a no-op. Absent on
// create (a blank form has no origin).
export interface MaterialOrigin {
  rows: MaterialFormRow[];
  materials: string[];
  materialTags?: string[];
  materialRefs?: MaterialRef[];
}

export interface FormState {
  title: string;
  altNames: string; // comma-separated, like materials
  type: CategoryId;
  place: Place;
  ages: AgeGroupId[];
  durationMin: string;
  groupMin: string;
  groupMax: string;
  energy: EnergyWord;
  prep: Prep;
  rating: number;
  blurb: string;
  // Kit as editable rows (was a comma-joined `materials: string`). The comma is
  // no longer a delimiter — a label may contain commas. `materialOrigin` carries
  // the seed provenance for byte-stable carry-through on save.
  materialRefs: MaterialFormRow[];
  materialOrigin?: MaterialOrigin;
  themeId: string;
  color: string; // "" = inherit the category tint
}

export type ExtractedRunText = {
  steps: string[];
  notes: string;
  safety: string;
  playbook: Activity["playbook"];
};

export const ENERGY_MAP: Record<EnergyWord, number> = { Calm: 1, Lively: 2, Rowdy: 3 };
export const ENERGY_WORD: Record<number, EnergyWord> = { 1: "Calm", 2: "Lively", 3: "Rowdy" };
const DEFAULT_DURATION = 20;

export const BLANK_FORM: FormState = {
  title: "",
  altNames: "",
  type: "Game",
  place: "Outside",
  ages: ["g46"],
  durationMin: "20",
  groupMin: "",
  groupMax: "",
  energy: "Lively",
  prep: "Low",
  rating: 0,
  blurb: "",
  materialRefs: [],
  themeId: "",
  color: "",
};

// ── Material rows ────────────────────────────────────────────────────────────
//
// LABEL-PRESERVATION SCHEME (the load-bearing invariant): a MaterialRef stores
// only { id, note }, so on reload with an empty catalog resolveRefs would label
// a ref by humanizing its slug — losing the exact typed text ("Flour, ~2 cups"
// slugs to "flour-2-cups" → "Flour 2 cups"). To keep a typed label rendering
// IDENTICALLY after save + reload without any catalog writes, save regenerates
// the legacy `materialTags` mirror as the PURE labels (no note suffix), written
// from the SAME ordered rows as `materialRefs` — so materialTags[i] is the
// display label for materialRefs[i]. formRowsFromActivity recovers each row's
// label from that aligned mirror (or the real catalog name when the id exists),
// and its note from the ref. Deterministic, honest, empty-catalog-safe.

function pairedTagLabels(a: Activity): string[] | null {
  const refs = Array.isArray(a.materialRefs) ? a.materialRefs : null;
  const tags = Array.isArray(a.materialTags) ? a.materialTags : null;
  // Only trust the pairing when refs + tags line up 1:1 (our own save shape).
  return refs && tags && refs.length === tags.length ? tags : null;
}

// Seed the editable rows from an activity. Uses resolveRefs (the one three-tier
// accessor) for ids + notes, then labels each row: catalog name if the id is a
// real catalog entry, else the index-aligned materialTags mirror (the typed
// label we wrote at save), else resolveRefs' humanized fallback.
export function formRowsFromActivity(a: Activity, catalog?: Material[]): MaterialFormRow[] {
  const paired = pairedTagLabels(a);
  return resolveRefs(a, catalog).map((ref, index): MaterialFormRow => {
    const catalogHit = catalog?.some((m) => m.id === ref.id) ?? false;
    const label = catalogHit ? ref.label : paired?.[index] ?? ref.label;
    return ref.note ? { id: ref.id, label, note: ref.note } : { id: ref.id, label };
  });
}

// Mint a fresh row from a typed name (the add-row path). The id is the birth
// slug of the name; `minted` marks it as re-sluggable on later renames THIS
// session. Returns null when the name slugs to nothing (empty / punctuation).
export function mintMaterialRow(name: string): MaterialFormRow | null {
  const label = name.trim();
  const id = materialTagId(label);
  if (!id || !label) return null;
  return { id, label, minted: true };
}

// Rename a row's label. A row minted THIS session re-slugs its id to match the
// new name (it has no stored references yet). A row that came from storage keeps
// its FROZEN id — a rename only changes the display label (and thus the mirror),
// never the join key that the on-hand set / stock keys reference.
export function renameMaterialRow(row: MaterialFormRow, name: string): MaterialFormRow | null {
  const label = name.trim();
  if (!label) return null;
  if (row.minted) {
    const id = materialTagId(label);
    if (!id) return null;
    return { ...row, id, label };
  }
  return { ...row, label };
}

// Clean the rows for save: trim labels/notes, drop label-less rows, and dedupe
// by id (first wins) so the mirrors stay index-aligned and free of collisions.
function cleanRows(rows: MaterialFormRow[]): MaterialFormRow[] {
  const seen = new Set<string>();
  const out: MaterialFormRow[] = [];
  for (const row of rows) {
    const label = row.label.trim();
    const id = row.id.trim();
    if (!label || !id || seen.has(id)) continue;
    seen.add(id);
    const note = row.note?.trim();
    out.push(note ? { id, label, note } : { id, label });
  }
  return out;
}

// True when two row lists carry the same id/label/note in the same order — the
// change-detection used to decide verbatim carry-through vs mirror regeneration.
function rowsEqual(a: MaterialFormRow[], b: MaterialFormRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) => row.id === b[i].id && row.label === b[i].label && (row.note ?? "") === (b[i].note ?? ""));
}

// Regenerate the canonical refs + legacy mirrors from cleaned rows. materialRefs
// is canonical (id + note); materialTags is the PURE labels (the reload label
// store); materials is the human line ("<label>" or "<label> — <note>") legacy
// consumers/exports already render. All three share the row order.
export function mirrorsFromRows(rows: MaterialFormRow[]): {
  materials: string[];
  materialTags: string[];
  materialRefs: MaterialRef[];
} {
  const clean = cleanRows(rows);
  return {
    materials: clean.map((row) => (row.note ? row.label + " — " + row.note : row.label)),
    materialTags: clean.map((row) => row.label),
    materialRefs: clean.map((row) => (row.note ? { id: row.id, note: row.note } : { id: row.id })),
  };
}

export function formFromActivity(a: Activity, themeId: string, catalog?: Material[]): FormState {
  const rows = formRowsFromActivity(a, catalog);
  return {
    title: a.title,
    altNames: (a.altNames ?? []).join(", "),
    type: a.type,
    place: a.place,
    ages: a.ages.length ? a.ages : ["g46"],
    durationMin: String(a.durationMin),
    groupMin: a.groupMin == null ? "" : String(a.groupMin),
    groupMax: a.groupMax == null ? "" : String(a.groupMax),
    energy: ENERGY_WORD[a.energy] ?? "Lively",
    prep: a.prep,
    rating: a.rating,
    blurb: a.blurb,
    materialRefs: rows,
    // Capture the seed rows + the ORIGINAL fields so an untouched save carries
    // them through byte-for-byte (no re-slug, no tag clobber).
    materialOrigin: {
      rows,
      materials: a.materials,
      materialTags: a.materialTags,
      materialRefs: a.materialRefs,
    },
    themeId,
    color: a.color ?? "",
  };
}

export function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseOptionalPositiveInt(value: string): number | null {
  return value.trim() ? parsePositiveInt(value) : null;
}

export function lines(value: string): string[] {
  return value.split(",").map((x) => x.trim()).filter(Boolean);
}

// Resolve the material fields for save. If the rows are UNCHANGED from the seed
// (the user opened + saved without touching the kit), carry the activity's
// original materials/materialTags/materialRefs through VERBATIM — byte-stable,
// no re-slug, no tag clobber (the verified bug we're killing). If they changed
// (or on create, where there's no origin), write materialRefs as canonical AND
// regenerate the legacy mirrors FROM the rows so older clients/exports work.
function materialFieldsForSave(f: FormState): {
  materials: string[];
  materialTags?: string[];
  materialRefs?: MaterialRef[];
} {
  const origin = f.materialOrigin;
  if (origin && rowsEqual(f.materialRefs, origin.rows)) {
    return {
      materials: origin.materials,
      materialTags: origin.materialTags,
      materialRefs: origin.materialRefs,
    };
  }
  const mirrors = mirrorsFromRows(f.materialRefs);
  return {
    materials: mirrors.materials,
    // Keep the fields ABSENT (not empty arrays) when there are no rows, matching
    // how the validators re-attach optionals and how quickActivity leaves them.
    materialTags: mirrors.materialTags.length ? mirrors.materialTags : undefined,
    materialRefs: mirrors.materialRefs.length ? mirrors.materialRefs : undefined,
  };
}

export function activityFromForm(f: FormState, id: string, extracted?: ExtractedRunText): Activity {
  const ages = f.ages.length ? f.ages : (["g46"] as AgeGroupId[]);
  const picked = AGE_GROUPS.filter((g) => ages.indexOf(g.id) >= 0);
  const duration = Math.min(parsePositiveInt(f.durationMin) || DEFAULT_DURATION, TOTAL_MIN);
  const altNames = lines(f.altNames);
  const material = materialFieldsForSave(f);

  const activity: Activity = {
    id,
    title: f.title.trim() || "Untitled activity",
    altNames: altNames.length ? altNames : undefined,
    type: f.type,
    place: f.place,
    ages,
    ageMin: Math.min(...picked.map((g) => g.min)),
    ageMax: Math.max(...picked.map((g) => g.max)),
    durationMin: duration,
    groupMin: parseOptionalPositiveInt(f.groupMin),
    groupMax: parseOptionalPositiveInt(f.groupMax),
    energy: ENERGY_MAP[f.energy],
    prep: f.prep,
    rating: f.rating,
    color: normalizeHexColor(f.color),
    blurb: f.blurb.trim() || "A new entry in the library.",
    materials: material.materials,
    steps: extracted?.steps || [],
    notes: extracted?.notes || "—",
    safety: extracted?.safety || "—",
    playbook: extracted?.playbook,
  };
  // Only attach the optional mirrors when present, so an activity with no kit
  // stays free of empty [] fields (matching quickActivity / the validators).
  if (material.materialTags) activity.materialTags = material.materialTags;
  if (material.materialRefs) activity.materialRefs = material.materialRefs;
  return activity;
}

// Build a minimal library Activity from just a title + length — the path the
// calendar's create bar takes when you name something new with "Save to library"
// on. Lands in the "Routine" bucket (the home for on-the-fly adds), with broad
// defaults the user can refine later in the library. Unlike activityFromForm it
// ALLOWS a 0-minute duration (a reminder); the form path clamps that up to a
// default, which would lose the reminder.
export function quickActivity(title: string, id: string, durationMin: number): Activity {
  const ages: AgeGroupId[] = ["g46"];
  const picked = AGE_GROUPS.filter((g) => ages.indexOf(g.id) >= 0);
  const safeDuration = Number.isFinite(durationMin) ? Math.round(durationMin) : 0;
  const duration = Math.max(0, Math.min(safeDuration, TOTAL_MIN));
  return {
    id,
    title: title.trim() || "Untitled activity",
    type: "Routine",
    place: "Both",
    ages,
    ageMin: Math.min(...picked.map((g) => g.min)),
    ageMax: Math.max(...picked.map((g) => g.max)),
    durationMin: duration,
    groupMin: null,
    groupMax: null,
    energy: 1,
    prep: "None",
    rating: 0,
    blurb: duration === 0 ? "A quick reminder saved from the calendar." : "Added from the calendar.",
    materials: [],
    materialTags: [],
    steps: [],
    notes: "—",
    safety: "—",
  };
}

// The scaffold (Details heading + tags, Materials checklist, "How to play"
// heading) is owned by the scalar controls — the step editor never shows or
// stores it. Stripped on load, re-derived on save. Scaffold headings are
// recognized by the deterministic id suffix every scaffold producer stamps
// (detailsHeadingBlock/playHeadingBlock) — a heading the USER made and merely
// named "Details" carries a runId() id, so it survives intact.
export function isScaffoldBlock(block: RunBlock): boolean {
  if (block.type === "details" || block.type === "materials") return true;
  return (
    block.type === "heading" &&
    (block.id.endsWith("-details-heading") || block.id.endsWith("-play-heading"))
  );
}

export function stripScaffold(doc: RunDoc): RunDoc {
  return { blocks: doc.blocks.filter((block) => !isScaffoldBlock(block)) };
}

function childText(child: RunChild): string {
  if (child.type === "video") return [child.title, child.url].filter(Boolean).join(" ");
  return child.text || "";
}

export function prepareRunDoc(doc: RunDoc, activityId: string, title: string): RunDoc {
  return {
    blocks: doc.blocks.map((block) => ({
      ...block,
      id: block.type === "details" ? activityId + "-details" : block.id,
      tags: block.type === "details" ? undefined : block.tags,
      children: (block.children || []).map((child) =>
        child.type === "diagram" && child.diagram
          ? { ...child, diagram: { ...child.diagram, activityId, title } }
          : { ...child }
      ),
    })),
  };
}

export function extractRunText(doc: RunDoc): ExtractedRunText {
  const steps: string[] = [];
  const notes: string[] = [];
  const safety: string[] = [];
  let playbook: Activity["playbook"];

  const collectChild = (child: RunChild) => {
    const text = childText(child).trim();
    if (child.type === "substep" && text) steps.push(text);
    if ((child.type === "note" || child.type === "variation" || child.type === "video") && text) notes.push(text);
    if (child.type === "safety" && text) safety.push(text);
    if (child.type === "diagram" && child.diagram && !playbook) playbook = child.diagram;
  };

  doc.blocks.forEach((block) => {
    const text = (block.text || "").trim();
    if (block.type === "step" && text) steps.push(text);
    if ((block.type === "note" || block.type === "variation") && text) notes.push(text);
    if (block.type === "safety" && text) safety.push(text);
    (block.children || []).forEach(collectChild);
  });

  return {
    steps,
    notes: notes.join("\n") || "—",
    safety: safety.join("\n") || "—",
    playbook,
  };
}

// The blank document a fresh activity opens with: a single empty step.
export function blankPlayDoc(): RunDoc {
  return { blocks: [{ id: runId("b"), type: "step", text: "", collapsed: false, children: [] }] };
}

// The play content seed for an existing activity: its stored override (or the
// derived doc), with the form-owned scaffold stripped so the run-doc editor
// shows only the instruction content. Mirrors AddView's playDoc initializer.
export function playDocForActivity(activity: Activity, initialRunDoc: RunDoc | null): RunDoc {
  if (initialRunDoc) return stripScaffold(cloneRunDoc(initialRunDoc));
  return stripScaffold(buildRunDoc(activity, activity.playbook ?? null));
}

// Validation gate shared by the save affordance (extracted so the surface and
// any caller agree on what "valid" means).
export interface FormValidation {
  duration: number | null;
  durationInvalid: boolean;
  groupMin: number | null;
  groupMax: number | null;
  groupMinInvalid: boolean;
  groupMaxInvalid: boolean;
  groupRangeInvalid: boolean;
  valid: boolean;
}

export function validateForm(f: FormState): FormValidation {
  const duration = parsePositiveInt(f.durationMin);
  const durationInvalid = duration == null || duration > TOTAL_MIN;
  const groupMin = parseOptionalPositiveInt(f.groupMin);
  const groupMax = parseOptionalPositiveInt(f.groupMax);
  const groupMinInvalid = f.groupMin.trim().length > 0 && groupMin == null;
  const groupMaxInvalid = f.groupMax.trim().length > 0 && groupMax == null;
  const groupRangeInvalid = groupMin != null && groupMax != null && groupMin > groupMax;
  const valid =
    f.title.trim().length > 0 &&
    !durationInvalid &&
    !groupMinInvalid &&
    !groupMaxInvalid &&
    !groupRangeInvalid;
  return {
    duration,
    durationInvalid,
    groupMin,
    groupMax,
    groupMinInvalid,
    groupMaxInvalid,
    groupRangeInvalid,
    valid,
  };
}

export const MAX_ACTIVITY_DURATION_MIN = TOTAL_MIN;

// Assemble the FULL run document for save: form-owned scaffold first, then the
// edited play content (re-stripped so nothing can double up), then re-key the
// details id + diagram identity to the activity. Returns the prepared doc AND
// the run text re-extracted from it (so the Activity's flat steps/notes/safety
// stay in sync). VERBATIM behavior from AddView.submit().
export function buildSaveDoc(
  f: FormState,
  id: string,
  playDoc: RunDoc
): { doc: RunDoc; extracted: ExtractedRunText } {
  const seed = activityFromForm(f, id);
  const playBlocks = stripScaffold(playDoc).blocks;
  const hasInstructions = playBlocks.some((block) => block.type === "step" || block.type === "playbook");
  // Include the (data-less) materials block iff the seed activity actually needs
  // something — the same gate buildRunDoc uses (materialNeedsForActivity), now
  // keyed off the resolved rows rather than the retired comma string.
  const needsMaterials = materialNeedsForActivity(seed).length > 0;
  const fullDoc: RunDoc = {
    blocks: [
      detailsHeadingBlock(seed),
      detailsBlock(seed),
      ...(needsMaterials ? [materialsBlock(id)] : []),
      ...(hasInstructions ? [playHeadingBlock(seed)] : []),
      ...playBlocks,
    ],
  };
  const doc = prepareRunDoc(fullDoc, id, f.title.trim());
  return { doc, extracted: extractRunText(doc) };
}

// The new-activity id: slugged title + a short timestamp suffix. VERBATIM from
// AddView.submit().
export function newActivityId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (slug || "custom-activity") + "-" + Date.now().toString(36);
}
