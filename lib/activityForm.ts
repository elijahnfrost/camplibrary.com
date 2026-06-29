// Shared activity-form model + save/extract logic for the unified create/edit
// surface. Lifted VERBATIM out of the old AddView form so the produced Activity
// + runLists override keep exactly the same shape — existing saved data still
// loads. The unified DetailSheet imports the FormState model, the field-control
// helpers (parsers/derivation), and the save-path scaffold logic from here so
// there is one source of truth for how a scalar property becomes Activity data.

import type { Activity, AgeGroupId, CategoryId, Place, Prep } from "./types";
import { AGE_GROUPS } from "./data";
import { normalizeHexColor } from "./color";
import { materialTagsFromMaterials } from "./materials";
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
  materials: string;
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
  materials: "",
  themeId: "",
  color: "",
};

export function formFromActivity(a: Activity, themeId: string): FormState {
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
    materials: a.materials.join(", "),
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

export function activityFromForm(f: FormState, id: string, extracted?: ExtractedRunText): Activity {
  const ages = f.ages.length ? f.ages : (["g46"] as AgeGroupId[]);
  const picked = AGE_GROUPS.filter((g) => ages.indexOf(g.id) >= 0);
  const duration = Math.min(parsePositiveInt(f.durationMin) || DEFAULT_DURATION, TOTAL_MIN);
  const materials = lines(f.materials);
  const altNames = lines(f.altNames);

  return {
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
    materials,
    materialTags: materialTagsFromMaterials(materials),
    steps: extracted?.steps || [],
    notes: extracted?.notes || "—",
    safety: extracted?.safety || "—",
    playbook: extracted?.playbook,
  };
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
  const fullDoc: RunDoc = {
    blocks: [
      detailsHeadingBlock(seed),
      detailsBlock(seed),
      ...(lines(f.materials).length ? [materialsBlock(id)] : []),
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
