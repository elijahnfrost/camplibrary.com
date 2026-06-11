// Camp Library — "The Run List" instruction document model.
//
// The Run List is the utilitarian, runnable view of an activity: a collapsible,
// nested instruction list. Each STEP owns attached detail blocks
// (note / safety / video / variation / sub-step) that tuck away on collapse, so
// the spine of the activity stays scannable with all the depth one click away.
//
// An activity's flat `steps` / `notes` / `safety` remain the seed source of
// truth. `buildRunDoc()` derives a sensible default document from them, and any
// hand-edited document is persisted as a per-activity override — the same
// pattern used for editable field diagrams (see lib/playbooks + playbookOverrides).

import type { Activity } from "./types";
import { ageSpan, ENERGY, groupLabel } from "./data";
import {
  blankPlaybook,
  normalizePlaybook,
  type ActivityPlaybookData,
} from "./playbooks";
import { materialNeedsForActivity } from "./materials";

// Details attach UNDER a step (intertwined with the flow), the way the original
// Field Book modeled it: a step owns a stack of notes, a diagram, a variation,
// etc. `video` carries title + url, `diagram` carries an embedded field
// diagram; everything else is a single editable line of text. `materials` is
// still accepted as a child for legacy saved docs, but defaults to a top-level
// miscellaneous block because it is prep, not necessarily a numbered action.
export type RunChildType =
  | "note"
  | "safety"
  | "video"
  | "variation"
  | "substep"
  | "diagram"
  | "materials";
export type RunBlockType =
  | "details"
  | "step"
  | "heading"
  | "note"
  | "safety"
  | "variation"
  | "playbook"
  | "materials";

export interface RunDetailTag {
  id: string;
  label: string;
  icon?: "pin" | "users" | "clock" | "energy" | "prep" | "rating" | "type";
}

export interface RunChild {
  id: string;
  type: RunChildType;
  text?: string;
  title?: string;
  url?: string;
  diagram?: ActivityPlaybookData;
}

export interface RunBlock {
  id: string;
  type: RunBlockType;
  // step / heading / note / safety / variation
  text?: string;
  // step: a small time/cue chip ("0:00 · setup", "wrap", …)
  time?: string;
  // playbook cross-link card
  title?: string;
  meta?: string;
  // details: derived activity chips, kept as a normal movable block.
  tags?: RunDetailTag[];
  // step: whether it renders collapsed by default
  collapsed?: boolean;
  children?: RunChild[];
}

export interface RunDoc {
  blocks: RunBlock[];
}

export const RUN_CHILD_TYPES: RunChildType[] = [
  "note",
  "safety",
  "variation",
  "substep",
  "video",
  "diagram",
  "materials",
];
const RUN_BLOCK_TYPES: RunBlockType[] = [
  "details",
  "step",
  "heading",
  "note",
  "safety",
  "variation",
  "playbook",
  "materials",
];

export const RUN_CHILD_META: Record<RunChildType, { label: string; placeholder: string }> = {
  note: { label: "Note", placeholder: "Add a side note…" },
  safety: { label: "Safety", placeholder: "What's the safety call here?" },
  video: { label: "Video", placeholder: "paste a YouTube link…" },
  variation: { label: "Variation", placeholder: "Describe a variation…" },
  substep: { label: "Sub-step", placeholder: "Break it down a step…" },
  diagram: { label: "Diagram", placeholder: "" },
  materials: { label: "Materials", placeholder: "" },
};

export const RUN_TOP_LABEL: Record<"heading" | "note" | "safety" | "variation" | "materials" | "details", string> = {
  details: "Specific details",
  heading: "Heading",
  note: "Note",
  safety: "Safety",
  variation: "Variation",
  materials: "Materials",
};

// Monotonic id factory — stable within a session, prefixed so collisions across
// derived vs. stored docs are impossible.
let runSeq = 0;
export function runId(prefix = "rb"): string {
  runSeq += 1;
  return prefix + "-" + runSeq.toString(36) + "-" + Math.floor(performance.now()).toString(36);
}

// Pluralized summary label for the collapsed-step pills ("2 safety notes").
export function runPillLabel(type: RunChildType, n: number): string {
  if (type === "video") return n > 1 ? n + " videos" : "video";
  if (type === "safety") return n > 1 ? n + " safety notes" : "safety note";
  if (type === "substep") return n + " sub-step" + (n > 1 ? "s" : "");
  if (type === "variation") return n > 1 ? n + " variations" : "variation";
  if (type === "diagram") return n > 1 ? n + " diagrams" : "diagram";
  if (type === "materials") return "materials";
  if (n === 1) return type;
  return n + " " + type + "s";
}

// A fresh, empty diagram detail seeded with a blank field.
export function blankDiagramChild(activityId: string, title: string): RunChild {
  return { id: runId("diagram"), type: "diagram", diagram: blankPlaybook(activityId, title) };
}

// A materials detail (renders the activity's kit checklist; carries no data).
export function materialsChild(activityId: string): RunChild {
  return { id: activityId + "-mat", type: "materials" };
}

export function materialsBlock(activityId: string): RunBlock {
  return { id: activityId + "-mat", type: "materials", children: [] };
}

export function detailTagsForActivity(activity: Activity): RunDetailTag[] {
  const tags: Array<RunDetailTag | null> = [
    { id: "place", label: activity.place, icon: "pin" },
    { id: "ages", label: ageSpan(activity), icon: "users" },
    { id: "group", label: groupLabel(activity) + " kids", icon: "users" },
    { id: "duration", label: activity.durationMin + " min", icon: "clock" },
    { id: "type", label: activity.type, icon: "type" },
    activity.energy ? { id: "energy", label: ENERGY[activity.energy], icon: "energy" } : null,
    { id: "prep", label: activity.prep === "None" ? "No prep" : activity.prep + " prep", icon: "prep" },
    activity.rating ? { id: "rating", label: activity.rating + "/5", icon: "rating" } : null,
  ];
  return tags.filter((tag): tag is RunDetailTag => Boolean(tag));
}

export function detailsBlock(activity: Activity): RunBlock {
  return { id: (activity.id || "a") + "-details", type: "details", tags: detailTagsForActivity(activity), children: [] };
}

export function detailsHeadingBlock(activity: Activity): RunBlock {
  return { id: (activity.id || "a") + "-details-heading", type: "heading", text: "Details", children: [] };
}

export function playHeadingBlock(activity: Activity): RunBlock {
  return { id: (activity.id || "a") + "-play-heading", type: "heading", text: "How to play", children: [] };
}

function headingText(block: RunBlock): string {
  return block.type === "heading" ? (block.text || "").trim().toLowerCase() : "";
}

function isInstructionBlock(block: RunBlock): boolean {
  return block.type === "step" || block.type === "playbook";
}

export function ensureSectionHeadings(activity: Activity, doc: RunDoc): RunDoc {
  const tags = detailTagsForActivity(activity);
  let found = false;
  let blocks = doc.blocks.map((block) => {
    if (block.type !== "details") return block;
    found = true;
    return { ...block, tags };
  });

  if (!found) {
    const materialIndex = blocks.findIndex((block) => block.type === "materials");
    blocks.splice(materialIndex >= 0 ? materialIndex : 0, 0, detailsBlock(activity));
  }

  const detailsIndex = blocks.findIndex((block) => block.type === "details");
  const hasDetailsHeading = blocks.some((block) => headingText(block) === "details");
  if (!hasDetailsHeading) {
    blocks.splice(Math.max(0, detailsIndex), 0, detailsHeadingBlock(activity));
  }

  const detailsHeadingIndex = blocks.findIndex((block) => headingText(block) === "details");
  const hasPlayHeading = blocks.some((block) => headingText(block) === "how to play");
  if (!hasPlayHeading) {
    const firstInstructionAfterDetails = blocks.findIndex(
      (block, index) => index > detailsHeadingIndex && isInstructionBlock(block)
    );
    if (firstInstructionAfterDetails >= 0) {
      blocks.splice(firstInstructionAfterDetails, 0, playHeadingBlock(activity));
    }
  }

  return { blocks };
}

// Derive a default Run List from an activity. The field diagram and materials
// checklist are seeded into the instruction stack, then the activity's notes
// and safety copy close it out, so nothing from the original card is lost.
export function buildRunDoc(activity: Activity, playbook: ActivityPlaybookData | null = null): RunDoc {
  const blocks: RunBlock[] = [];
  const base = activity.id || "a";

  blocks.push(detailsHeadingBlock(activity));
  blocks.push(detailsBlock(activity));

  // Materials are prep/miscellaneous, not necessarily part of a numbered step.
  // Keep them before the first parent block by default.
  if (materialNeedsForActivity(activity).length) blocks.push(materialsBlock(base));

  if (activity.steps.length || playbook) blocks.push(playHeadingBlock(activity));

  // Detail that belongs to "setting up" the activity.
  const setupKids: RunChild[] = [];
  if (playbook) setupKids.push({ id: base + "-diagram", type: "diagram", diagram: playbook });

  if (activity.steps.length) {
    activity.steps.forEach((text, i) => {
      blocks.push({
        id: base + "-s" + i,
        type: "step",
        text,
        collapsed: false,
        children: i === 0 ? setupKids : [],
      });
    });
  } else if (setupKids.length) {
    blocks.push({ id: base + "-s0", type: "step", text: "Set up", collapsed: false, children: setupKids });
  }

  const notes = (activity.notes || "").trim();
  const safety = (activity.safety || "").trim();

  if (notes || safety) {
    blocks.push({ id: base + "-h-wrap", type: "heading", text: "Notes & safety", children: [] });
  }
  if (notes) {
    blocks.push({ id: base + "-notes", type: "variation", text: notes, children: [] });
  }
  if (safety) {
    blocks.push({ id: base + "-safety", type: "safety", text: safety, children: [] });
  }

  return { blocks };
}

// Saved v2 documents may still have a materials child attached under step 1.
// Promote it into a top-level miscellaneous block so the document renders with
// the current structure without throwing away other saved edits.
export function promoteMaterialsBlocks(doc: RunDoc): RunDoc {
  let firstMaterialId: string | null = null;
  let firstParentIndex = -1;
  let changed = false;
  const hasTopMaterials = doc.blocks.some((b) => b.type === "materials");

  const stripped = doc.blocks.map((b, blockIndex) => {
    const children = b.children || [];
    const withoutMaterials = children.filter((c) => {
      if (c.type !== "materials") return true;
      if (!firstMaterialId) {
        firstMaterialId = c.id;
        firstParentIndex = blockIndex;
      }
      changed = true;
      return false;
    });
    return withoutMaterials.length === children.length ? b : { ...b, children: withoutMaterials };
  });

  if (!changed) return doc;
  if (hasTopMaterials || !firstMaterialId) return { blocks: stripped };

  const insertAt = Math.max(0, firstParentIndex);
  const topMaterials: RunBlock = { id: firstMaterialId, type: "materials", children: [] };
  return {
    blocks: [...stripped.slice(0, insertAt), topMaterials, ...stripped.slice(insertAt)],
  };
}

// ---- storage validation -----------------------------------------------------
// Parse an untrusted (localStorage) value into a RunDoc, dropping anything
// malformed. Mirrors normalizePlaybook so persisted overrides can never crash
// the viewer.

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeChild(raw: unknown, index: number): RunChild | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (typeof type !== "string" || !RUN_CHILD_TYPES.includes(type as RunChildType)) return null;
  const id = asString(r.id) || runId("k") + "-" + index;
  if (type === "video") {
    return { id, type: "video", title: asString(r.title) ?? "", url: asString(r.url) ?? "" };
  }
  if (type === "diagram") {
    const diagram = normalizePlaybook(r.diagram);
    if (!diagram) return null;
    return { id, type: "diagram", diagram };
  }
  if (type === "materials") {
    return { id, type: "materials" };
  }
  return { id, type: type as RunChildType, text: asString(r.text) ?? "" };
}

function normalizeBlock(raw: unknown, index: number): RunBlock | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (typeof type !== "string" || !RUN_BLOCK_TYPES.includes(type as RunBlockType)) return null;
  const id = asString(r.id) || runId("b") + "-" + index;
  const children = Array.isArray(r.children)
    ? r.children.map((c, i) => normalizeChild(c, i)).filter((c): c is RunChild => Boolean(c))
    : [];

  if (type === "playbook") {
    return { id, type: "playbook", title: asString(r.title) ?? "", meta: asString(r.meta) ?? "", children };
  }
  if (type === "materials") {
    return { id, type: "materials", children };
  }
  if (type === "details") {
    const tags = Array.isArray(r.tags)
      ? r.tags
          .map((tag, tagIndex) => {
            if (typeof tag !== "object" || tag === null) return null;
            const t = tag as Record<string, unknown>;
            const label = asString(t.label);
            if (!label) return null;
            const icon = asString(t.icon);
            const normalized: RunDetailTag = {
              id: asString(t.id) || "tag-" + tagIndex,
              label,
            };
            if (
              icon === "pin" ||
              icon === "users" ||
              icon === "clock" ||
              icon === "energy" ||
              icon === "prep" ||
              icon === "rating" ||
              icon === "type"
            ) {
              normalized.icon = icon;
            }
            return normalized;
          })
          .filter((tag): tag is RunDetailTag => Boolean(tag))
      : [];
    return { id, type: "details", tags, children };
  }
  if (type === "step") {
    return {
      id,
      type: "step",
      text: asString(r.text) ?? "",
      time: asString(r.time),
      collapsed: r.collapsed === true,
      children,
    };
  }
  // heading / note / safety / variation
  return { id, type: type as RunBlockType, text: asString(r.text) ?? "", children };
}

export function normalizeRunDoc(raw: unknown): RunDoc | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.blocks)) return null;
  const blocks = r.blocks.map((b, i) => normalizeBlock(b, i)).filter((b): b is RunBlock => Boolean(b));
  return { blocks };
}

// A fresh empty step (the unit Enter inserts while editing).
export function blankStepBlock(): RunBlock {
  return { id: runId("b"), type: "step", text: "", collapsed: false, children: [] };
}

// Insert a block immediately after `afterId` (append when the id is unknown).
// Optionally patches the anchor block in the same operation — Enter-to-split
// commits the current step's text and inserts the next step atomically, so a
// single onChange fires.
export function insertBlockAfter(
  doc: RunDoc,
  afterId: string,
  block: RunBlock,
  anchorPatch?: Partial<RunBlock>
): RunDoc {
  const index = doc.blocks.findIndex((b) => b.id === afterId);
  const blocks = doc.blocks.map((b) =>
    anchorPatch && b.id === afterId ? { ...b, ...anchorPatch } : b
  );
  if (index < 0) return { blocks: [...blocks, block] };
  return { blocks: [...blocks.slice(0, index + 1), block, ...blocks.slice(index + 1)] };
}

// Insert a block at a top-level index (the between-rows "+" affordance).
export function insertBlockAt(doc: RunDoc, index: number, block: RunBlock): RunDoc {
  const at = Math.max(0, Math.min(doc.blocks.length, index));
  return { blocks: [...doc.blocks.slice(0, at), block, ...doc.blocks.slice(at)] };
}

// A deep, id-preserving clone so the editor never mutates persisted state.
export function cloneRunDoc(doc: RunDoc): RunDoc {
  return {
    blocks: doc.blocks.map((b) => ({
      ...b,
      children: (b.children || []).map((c) => ({ ...c })),
    })),
  };
}
