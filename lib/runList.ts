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
  clonePlaybook,
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
  | "fieldnote"
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
  | "fieldnote"
  | "playbook"
  | "materials";

// A text-ish block/child (note / safety / variation / substep / heading) can
// carry an OPTIONAL presentation override: a glyph + colour chosen on the run
// sheet. The block's TYPE stays the semantic anchor — print, the public run
// page, and form round-trip all keep reading `type`, so nothing downstream
// breaks. icon/color only change how the node looks; unset → derived from type.
export type RunIcon = "note" | "safety" | "tip" | "bell" | "star" | "flag";
export type RunColor = "none" | "green" | "amber" | "clay" | "dusk" | "wood";
export const RUN_ICONS: RunIcon[] = ["note", "safety", "tip", "bell", "star", "flag"];
export const RUN_COLORS: RunColor[] = ["none", "green", "amber", "clay", "dusk", "wood"];
// Colour → design token, consumed by the run-sheet CSS via an inline --rl-blk.
export const RUN_COLOR_TOKEN: Record<RunColor, string> = {
  none: "var(--ink-soft)",
  green: "var(--accent)",
  amber: "var(--amber)",
  clay: "var(--clay)",
  dusk: "var(--dusk)",
  wood: "var(--wood-soft)",
};
// The default glyph a text-ish block wears when it carries no explicit icon —
// derived from its semantic type so existing/derived docs look right untouched.
export function defaultRunIcon(type: RunBlockType | RunChildType): RunIcon {
  if (type === "safety") return "safety";
  if (type === "variation") return "tip";
  return "note";
}

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
  // fieldnote entry: the captured stamp — a local "YYYY-MM-DDTHH:mm" for new
  // notes (date + time), or a legacy date-only "YYYY-MM-DD". Optional so other
  // detail types ignore it.
  at?: string;
  // text-ish details (note / safety / variation / substep): presentation override.
  icon?: RunIcon;
  color?: RunColor;
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
  // fieldnote: a "Field notes" log is a container — its dated entries live in
  // `children`. (Legacy flat notes stored their text/at on the block itself;
  // normalizeBlock folds that into a first entry.)
  at?: string;
  // heading / note / safety / variation: presentation override (see RunIcon).
  icon?: RunIcon;
  color?: RunColor;
  children?: RunChild[];
}

export interface RunDoc {
  blocks: RunBlock[];
}

export const RUN_CHILD_TYPES: RunChildType[] = [
  "note",
  "safety",
  "variation",
  "fieldnote",
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
  "fieldnote",
  "playbook",
  "materials",
];

export const RUN_CHILD_META: Record<RunChildType, { label: string; placeholder: string }> = {
  note: { label: "Note", placeholder: "Add a side note…" },
  safety: { label: "Safety", placeholder: "What's the safety call here?" },
  video: { label: "Media", placeholder: "YouTube, Vimeo, or a link…" },
  variation: { label: "Variation", placeholder: "Describe a variation…" },
  fieldnote: { label: "Field note", placeholder: "What did you notice to change next time?" },
  substep: { label: "Sub-step", placeholder: "Break it down a step…" },
  diagram: { label: "Diagram", placeholder: "" },
  materials: { label: "Materials", placeholder: "" },
};

export const RUN_TOP_LABEL: Record<
  "heading" | "note" | "safety" | "variation" | "fieldnote" | "materials" | "details",
  string
> = {
  details: "Specific details",
  heading: "Heading",
  note: "Note",
  safety: "Safety",
  variation: "Variation",
  fieldnote: "Field note",
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
  if (type === "video") return n > 1 ? n + " media" : "media";
  if (type === "safety") return n > 1 ? n + " safety notes" : "safety note";
  if (type === "substep") return n + " sub-step" + (n > 1 ? "s" : "");
  if (type === "variation") return n > 1 ? n + " variations" : "variation";
  if (type === "fieldnote") return n > 1 ? n + " field notes" : "field note";
  if (type === "diagram") return n > 1 ? n + " diagrams" : "diagram";
  if (type === "materials") return "materials";
  if (n === 1) return type;
  return n + " " + type + "s";
}

// Today as an ISO date (YYYY-MM-DD). Kept for legacy field notes that stored a
// date-only stamp; new entries also capture the time (see nowStamp).
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// Local wall-clock stamp "YYYY-MM-DDTHH:mm" for a freshly captured note. Built
// from LOCAL components (not UTC) so the dated/timed chip reads the way the
// counselor saw the clock, with no timezone reparse drift on the date.
export function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

// One dated note entry — the unit you jot into the log, stamped with the local
// date + time it was captured.
export function fieldNoteChild(text = ""): RunChild {
  return { id: runId("fn"), type: "fieldnote", text, at: nowStamp() };
}

// A self-contained "Field notes" log: a container block holding dated entries
// as children. The id is deterministic when seeded into the Details section (so
// the derived doc merges cleanly), and a fresh runId when added from the palette.
export function fieldNotesBlock(id: string = runId("fn")): RunBlock {
  return { id, type: "fieldnote", children: [] };
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

function isInstructionBlock(block: RunBlock): boolean {
  return block.type === "step" || block.type === "playbook";
}

function isDetailsHeading(block: RunBlock, activity: Activity): boolean {
  if (block.type !== "heading") return false;
  const expectedId = (activity.id || "a") + "-details-heading";
  if (block.id === expectedId) return true;
  // Legacy fallback: unnamed/id-less docs matched only by text.
  return (block.text || "").trim().toLowerCase() === "details";
}

function isPlayHeading(block: RunBlock, activity: Activity): boolean {
  if (block.type !== "heading") return false;
  const expectedId = (activity.id || "a") + "-play-heading";
  if (block.id === expectedId) return true;
  // Legacy fallback: unnamed/id-less docs matched only by text.
  return (block.text || "").trim().toLowerCase() === "how to play";
}

export function ensureSectionHeadings(activity: Activity, doc: RunDoc): RunDoc {
  const tags = detailTagsForActivity(activity);
  let found = false;
  let blocks = doc.blocks.map((block) => {
    if (block.type !== "details") return block;
    found = true;
    // Seed the derived activity facts only when the details block carries no
    // tags of its own. Once a staffer hand-edits them on the run sheet, those
    // tags persist (the same override philosophy as steps/notes/safety); the
    // form re-strips them on save, so a form edit still refreshes the facts.
    return block.tags && block.tags.length ? block : { ...block, tags };
  });

  if (!found) {
    const materialIndex = blocks.findIndex((block) => block.type === "materials");
    blocks.splice(materialIndex >= 0 ? materialIndex : 0, 0, detailsBlock(activity));
  }

  const detailsIndex = blocks.findIndex((block) => block.type === "details");
  const hasDetailsHeading = blocks.some((block) => isDetailsHeading(block, activity));
  if (!hasDetailsHeading) {
    const detailsHeading = detailsHeadingBlock(activity);
    // Guard: never insert if a block with this id already exists (renamed heading).
    if (!blocks.some((b) => b.id === detailsHeading.id)) {
      blocks.splice(Math.max(0, detailsIndex), 0, detailsHeading);
    }
  }

  const detailsHeadingIndex = blocks.findIndex((block) => isDetailsHeading(block, activity));
  const hasPlayHeading = blocks.some((block) => isPlayHeading(block, activity));
  if (!hasPlayHeading) {
    const playHeading = playHeadingBlock(activity);
    // Guard: never insert if a block with this id already exists (renamed heading).
    if (!blocks.some((b) => b.id === playHeading.id)) {
      const firstInstructionAfterDetails = blocks.findIndex(
        (block, index) => index > detailsHeadingIndex && isInstructionBlock(block)
      );
      if (firstInstructionAfterDetails >= 0) {
        blocks.splice(firstInstructionAfterDetails, 0, playHeading);
      }
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
  // A running Field notes log sits in the Details section, ahead of the play
  // steps — a self-contained block staff jot dated observations into while the
  // activity runs. Seeded into the DERIVED doc only (never re-injected into a
  // saved override), so once it's deleted the deletion sticks.
  blocks.push(fieldNotesBlock(base + "-fieldnotes"));

  // Materials are prep/miscellaneous, not necessarily part of a numbered step.
  // Keep them before the first parent block by default.
  if (materialNeedsForActivity(activity).length) blocks.push(materialsBlock(base));

  if (activity.steps.length || playbook) blocks.push(playHeadingBlock(activity));

  // Detail that belongs to "setting up" the activity: the field diagram, then
  // any demo videos / tutorials / reference links so a counselor previews them
  // while prepping. Media + links both render as "Media" details (inline player
  // for YouTube/Vimeo, link card otherwise).
  const setupKids: RunChild[] = [];
  if (playbook) setupKids.push({ id: base + "-diagram", type: "diagram", diagram: playbook });
  (activity.media || []).forEach((item, i) => {
    setupKids.push({ id: base + "-media" + i, type: "video", title: item.title || "", url: item.url });
  });
  (activity.links || []).forEach((item, i) => {
    setupKids.push({ id: base + "-link" + i, type: "video", title: item.label || "", url: item.url });
  });

  // Sub-steps ride under their step, aligned by index to `steps`.
  const subStepsFor = (i: number): RunChild[] =>
    (activity.subsets?.[i] || []).map((text, j) => ({
      id: base + "-s" + i + "-sub" + j,
      type: "substep",
      text,
    }));

  if (activity.steps.length) {
    activity.steps.forEach((text, i) => {
      blocks.push({
        id: base + "-s" + i,
        type: "step",
        text,
        collapsed: false,
        children: i === 0 ? [...setupKids, ...subStepsFor(i)] : subStepsFor(i),
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

  // Alternate rules / scalings close out the sheet as their own section.
  const variations = (activity.variations || []).map((text) => text.trim()).filter(Boolean);
  if (variations.length) {
    blocks.push({ id: base + "-h-vary", type: "heading", text: "Variations", children: [] });
    variations.forEach((text, i) => {
      blocks.push({ id: base + "-vary" + i, type: "variation", text, children: [] });
    });
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

function asIcon(value: unknown): RunIcon | undefined {
  return typeof value === "string" && (RUN_ICONS as string[]).includes(value) ? (value as RunIcon) : undefined;
}
function asColor(value: unknown): RunColor | undefined {
  return typeof value === "string" && (RUN_COLORS as string[]).includes(value) ? (value as RunColor) : undefined;
}
// Attach a validated icon/color override to a normalized text-ish block/child.
function withDeco<T extends { icon?: RunIcon; color?: RunColor }>(obj: T, r: Record<string, unknown>): T {
  const icon = asIcon(r.icon);
  const color = asColor(r.color);
  if (icon) obj.icon = icon;
  if (color) obj.color = color;
  return obj;
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
  if (type === "fieldnote") {
    const child: RunChild = { id, type: "fieldnote", text: asString(r.text) ?? "" };
    const at = asString(r.at);
    if (at) child.at = at;
    return child;
  }
  const child: RunChild = { id, type: type as RunChildType, text: asString(r.text) ?? "" };
  return withDeco(child, r);
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
  if (type === "fieldnote") {
    // A "Field notes" log is a container of dated entries (children). Legacy
    // flat field notes stored their text/at on the block itself — fold that
    // into a first entry so old drafts upgrade into the multi-note log losslessly.
    const block: RunBlock = { id, type: "fieldnote", children };
    const legacyText = (asString(r.text) ?? "").trim();
    if (legacyText && !children.some((c) => c.type === "fieldnote")) {
      const entry: RunChild = { id: runId("fn"), type: "fieldnote", text: legacyText };
      const at = asString(r.at);
      if (at) entry.at = at;
      block.children = [entry, ...children];
    }
    return block;
  }
  // heading / note / safety / variation
  const block: RunBlock = { id, type: type as RunBlockType, text: asString(r.text) ?? "", children };
  return withDeco(block, r);
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

// ---- drag + drop model (pure, unit-tested) ----------------------------------
// Extracted from the view so the placement RULES are testable and predictable.
// Two deliberate guarantees fix the old "feels cumbersome / lands in the wrong
// place" behavior:
//   1. Dropping in the gap before/after ANY block is always a top-level move —
//      a block can never be sucked *into* a step (or a heading) just because the
//      step happened to be expanded. That implicit auto-nest is gone.
//   2. Nesting a detail under a step is intentional: it only happens when you
//      drop directly ONTO one of that step's existing detail rows.

export type DragItem =
  | { kind: "top"; id: string }
  | { kind: "child"; parentId: string; id: string };

type DropPosition = "before" | "after";

export type DropTarget = {
  item: DragItem;
  position: DropPosition;
};

export type DropDestination =
  | { scope: "top"; targetId: string; position: DropPosition }
  | { scope: "children"; parentId: string; targetChildId: string | null; position: DropPosition };

export function sameDragItem(a: DragItem | null, b: DragItem): boolean {
  if (!a || a.kind !== b.kind || a.id !== b.id) return false;
  return a.kind === "top" || b.kind === "top" || a.parentId === b.parentId;
}

// A top-level block that can also live as a detail under a step. A Field notes
// log is a multi-entry container, so it stays top-level (never demoted to one
// lossy child) — the dedicated block in the Details section, not an attachment.
export function childFromTop(block: RunBlock): RunChild | null {
  if (block.type === "note" || block.type === "safety" || block.type === "variation") {
    const child: RunChild = { id: block.id, type: block.type, text: block.text || "" };
    if (block.icon) child.icon = block.icon;
    if (block.color) child.color = block.color;
    return child;
  }
  if (block.type === "materials") return { id: block.id, type: "materials" };
  return null;
}

// A detail that can be promoted to a top-level block. (A legacy field-note
// detail stays put — field notes now live in the dedicated log container.)
export function topFromChild(child: RunChild): RunBlock | null {
  if (child.type === "note" || child.type === "safety" || child.type === "variation") {
    const block: RunBlock = { id: child.id, type: child.type, text: child.text || "", children: [] };
    if (child.icon) block.icon = child.icon;
    if (child.color) block.color = child.color;
    return block;
  }
  if (child.type === "substep") {
    return { id: child.id, type: "step", text: child.text || "", collapsed: false, children: [] };
  }
  if (child.type === "materials") return { id: child.id, type: "materials", children: [] };
  return null;
}

function isChildCapable(item: DragItem, blocks: RunBlock[]): boolean {
  if (item.kind === "child") return true;
  const block = blocks.find((b) => b.id === item.id);
  return Boolean(block && childFromTop(block));
}

function isTopCapable(item: DragItem, blocks: RunBlock[]): boolean {
  if (item.kind === "top") return true;
  const parent = blocks.find((b) => b.id === item.parentId);
  const child = parent?.children?.find((k) => k.id === item.id);
  return Boolean(child && topFromChild(child));
}

// Where a drag lands. Returns null when the move is a no-op or not allowed.
export function resolveDrop(source: DragItem, target: DropTarget, blocks: RunBlock[]): DropDestination | null {
  if (sameDragItem(source, target.item)) return null;

  // Dropping onto an existing detail row nests the source as a sibling detail —
  // the ONE intentional way to nest under a step.
  if (target.item.kind === "child") {
    if (!isChildCapable(source, blocks)) return null;
    return {
      scope: "children",
      parentId: target.item.parentId,
      targetChildId: target.item.id,
      position: target.position,
    };
  }

  // Dropping onto (the gap around) a top-level block is always a top-level move.
  const targetBlock = blocks.find((b) => b.id === target.item.id);
  if (!targetBlock) return null;
  if (!isTopCapable(source, blocks)) return null;
  return { scope: "top", targetId: targetBlock.id, position: target.position };
}

// Apply a resolved destination, returning the new block list (or null on a
// stale/invalid move). Pure — never mutates the input.
export function applyDrop(blocks: RunBlock[], source: DragItem, destination: DropDestination): RunBlock[] | null {
  let movingTop: RunBlock | null = null;
  let movingChild: RunChild | null = null;
  let next: RunBlock[] = blocks.map((b) => ({ ...b, children: [...(b.children || [])] }));

  if (source.kind === "top") {
    const sourceIndex = next.findIndex((b) => b.id === source.id);
    if (sourceIndex < 0) return null;
    [movingTop] = next.splice(sourceIndex, 1);
  } else {
    next = next.map((b) => {
      if (b.id !== source.parentId) return b;
      const childIndex = (b.children || []).findIndex((k) => k.id === source.id);
      if (childIndex < 0) return b;
      const nextChildren = [...(b.children || [])];
      [movingChild] = nextChildren.splice(childIndex, 1);
      return { ...b, children: nextChildren };
    });
    if (!movingChild) return null;
  }

  if (destination.scope === "top") {
    const block = movingTop || (movingChild ? topFromChild(movingChild) : null);
    const targetIndex = next.findIndex((b) => b.id === destination.targetId);
    if (!block || targetIndex < 0) return null;
    next.splice(destination.position === "before" ? targetIndex : targetIndex + 1, 0, block);
    return next;
  }

  const child = movingChild || (movingTop ? childFromTop(movingTop) : null);
  if (!child) return null;
  let inserted = false;
  next = next.map((b) => {
    if (b.id !== destination.parentId) return b;
    const children = [...(b.children || [])];
    const targetIndex =
      destination.targetChildId == null ? -1 : children.findIndex((k) => k.id === destination.targetChildId);
    const insertAt =
      destination.targetChildId == null
        ? 0
        : destination.position === "before"
          ? targetIndex
          : targetIndex + 1;
    if (insertAt < 0) return b;
    children.splice(insertAt, 0, child);
    inserted = true;
    return { ...b, children };
  });
  return inserted ? next : null;
}

// Copy a single detail, deep-cloning any embedded diagram so the copy can never
// share a frame/marker/zone with the source. `id` defaults to the source id
// (id-preserving clone); pass a fresh id to reissue identity.
export function cloneRunChild(child: RunChild, id: string = child.id): RunChild {
  return child.diagram ? { ...child, id, diagram: clonePlaybook(child.diagram) } : { ...child, id };
}

// A deep, id-preserving clone so the editor never mutates persisted state.
export function cloneRunDoc(doc: RunDoc): RunDoc {
  return {
    blocks: doc.blocks.map((b) => ({
      ...b,
      children: (b.children || []).map((c) => cloneRunChild(c)),
    })),
  };
}

// Deep-copy a run doc onto a NEW activity identity. Block ids derived from the
// source activity id (`<id>-details`, `<id>-details-heading`, `<id>-play-heading`,
// `<id>-mat`, …) carry that prefix forward so section detection
// (isDetailsHeading/ensureSectionHeadings) keeps matching the copy; every other
// id — and every child id — is reissued fresh so the two activities can never
// collide on block identity (which would corrupt drag/reorder/focus). Used by
// duplicateActivity.
export function rekeyRunDoc(doc: RunDoc, oldActivityId: string, newActivityId: string): RunDoc {
  const oldPrefix = (oldActivityId || "a") + "-";
  const rekeyBlockId = (id: string): string =>
    id.startsWith(oldPrefix) ? newActivityId + "-" + id.slice(oldPrefix.length) : runId("b");
  return {
    blocks: doc.blocks.map((b) => ({
      ...b,
      id: rekeyBlockId(b.id),
      children: (b.children || []).map((c) => cloneRunChild(c, runId("k"))),
    })),
  };
}
