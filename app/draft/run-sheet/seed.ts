// DRAFT prototype data — the run sheet pared down to TWO core block kinds:
//   · number — an auto-numbered step
//   · text   — a line of copy you give meaning to by picking an icon + colour
// (materials / media / divider stay as small utility blocks.)
// Any block can be a sub-block (Tab) regardless of kind — sub-ness is a free
// property, not a separate type. This stays deliberately apart from
// lib/runList.ts so the experiment can't touch production state.

export type BlockKind = "number" | "text" | "materials" | "media" | "divider";

// The icon a text block wears in its dot. "none" = a plain dot.
export type BlockIcon = "none" | "note" | "tip" | "safety" | "info" | "star" | "flag";
// The colour of that dot (and the lighter ones it tints).
export type BlockColor = "none" | "green" | "amber" | "clay" | "dusk" | "wood";

export interface DraftBlock {
  id: string;
  kind: BlockKind;
  text?: string;
  /** number block: a small cue chip ("0:00 · gather", "wrap"). */
  time?: string;
  /** text block: the dot's glyph. */
  icon?: BlockIcon;
  /** text block: the dot's colour. */
  color?: BlockColor;
  /** media block: the link. */
  url?: string;
  /** materials block: the kit checklist. */
  items?: string[];
  /** 0 = a block on the spine, 1 = a lighter sub-block under the one above. */
  depth?: 0 | 1;
}

export interface DraftSection {
  id: string;
  title: string;
  collapsed?: boolean;
  blocks: DraftBlock[];
}

export interface DraftSheet {
  id: string;
  name: string;
  meta: string;
  sections: DraftSection[];
}

// The colour palette a text block can pick from, mapped to design tokens.
export const COLORS: Record<BlockColor, { label: string; token: string }> = {
  none: { label: "Neutral", token: "var(--ink-faint)" },
  green: { label: "Green", token: "var(--accent)" },
  amber: { label: "Amber", token: "var(--amber)" },
  clay: { label: "Clay", token: "var(--clay)" },
  dusk: { label: "Dusk", token: "var(--dusk)" },
  wood: { label: "Wood", token: "var(--wood-soft)" },
};
export const COLOR_IDS: BlockColor[] = ["none", "green", "amber", "clay", "dusk", "wood"];
export const ICON_IDS: BlockIcon[] = ["none", "note", "tip", "safety", "info", "star", "flag"];
export const ICON_LABEL: Record<BlockIcon, string> = {
  none: "Plain dot",
  note: "Note",
  tip: "Tip",
  safety: "Safety",
  info: "Info",
  star: "Star",
  flag: "Flag",
};

export const KIND_LABEL: Record<BlockKind, string> = {
  number: "Number",
  text: "Text",
  materials: "Materials",
  media: "Media",
  divider: "Divider",
};

// What the "+" insert menu offers, in order. Number + Text lead; the rest are
// small utilities.
export const INSERT_KINDS: BlockKind[] = ["number", "text", "materials", "media", "divider"];

export const EXAMPLES: DraftSheet[] = [
  {
    id: "parachute",
    name: "Parachute Cat & Mouse",
    meta: "Game · Grades 4–6 · 25 kids · 20 min · Field",
    sections: [
      {
        id: "p-setup",
        title: "Setup",
        blocks: [
          { id: "p-mat", kind: "materials", items: ["Parachute", "2 soft foam balls", "4 cones to mark the circle"] },
          { id: "p-n1", kind: "text", icon: "note", color: "none", text: "Spread out on open grass — clear the circle of bags and water bottles first." },
        ],
      },
      {
        id: "p-play",
        title: "How to play",
        blocks: [
          { id: "p-s1", kind: "number", time: "0:00 · gather", text: "Everyone grips the parachute edge and starts low, fast ripples." },
          { id: "p-s1a", kind: "text", icon: "tip", color: "amber", depth: 1, text: "Pick one Mouse (goes under) and one Cat (crawls on top)." },
          { id: "p-s2", kind: "number", time: "play", text: "On “GO”, the Cat chases the Mouse across the rippling chute." },
          { id: "p-s2a", kind: "text", icon: "safety", color: "clay", depth: 1, text: "Cat stays on hands and knees — no running or standing on the fabric." },
          { id: "p-s3", kind: "number", text: "Mouse escapes by ducking out an edge. Swap both roles about every minute." },
        ],
      },
      {
        id: "p-notes",
        title: "Notes & safety",
        blocks: [
          { id: "p-saf", kind: "text", icon: "safety", color: "clay", text: "Watch for kids wrapping the handles around their wrists." },
          { id: "p-note", kind: "text", icon: "note", color: "none", text: "A great low-prep energy burner between two seated activities." },
        ],
      },
      {
        id: "p-vary",
        title: "Variations",
        blocks: [
          { id: "p-v1", kind: "text", icon: "tip", color: "amber", text: "Add a second Mouse for a bigger or rowdier group." },
          { id: "p-v2", kind: "text", icon: "tip", color: "amber", text: "Calm-down round: the whole group lifts a “mushroom” dome and sits inside." },
          { id: "p-v3", kind: "media", text: "Parachute games — demo", url: "https://www.youtube.com/results?search_query=parachute+games+for+camp" },
        ],
      },
    ],
  },
  {
    id: "planets",
    name: "Papier-Mâché Planets",
    meta: "Craft · Grades 4–6 · 25 kids · 2 sessions · Art room",
    sections: [
      {
        id: "m-mat",
        title: "Materials",
        blocks: [
          { id: "m-mat1", kind: "materials", items: ["Balloons", "Newspaper, torn in strips", "Flour-and-water paste", "Tempera paint", "String"] },
          { id: "m-mn", kind: "text", icon: "safety", color: "clay", text: "Flour paste only at this station — no hot glue." },
        ],
      },
      {
        id: "m-d1",
        title: "Day 1 — build the planet",
        blocks: [
          { id: "m-s1", kind: "number", time: "0:00", text: "Blow a balloon up to about grapefruit size and knot it." },
          { id: "m-s2", kind: "number", text: "Dip newspaper strips in paste and smooth them over the balloon — 2 to 3 layers." },
          { id: "m-s2a", kind: "text", icon: "tip", color: "amber", depth: 1, text: "Leave a small bare patch by the knot so you can pop and pull the balloon out later." },
          { id: "m-s3", kind: "number", time: "dry", text: "Rest it on a cup and let it dry overnight." },
        ],
      },
      {
        id: "m-d2",
        title: "Day 2 — paint & hang",
        blocks: [
          { id: "m-s4", kind: "number", text: "Pop the balloon, pull it out, and paint the planet." },
          { id: "m-s4a", kind: "text", icon: "note", color: "none", depth: 1, text: "Base coat first; let it set before adding rings, swirls, and craters." },
          { id: "m-s5", kind: "number", text: "Thread string through the top so it can hang from the ceiling." },
        ],
      },
      {
        id: "m-notes",
        title: "Notes",
        blocks: [
          { id: "m-n1", kind: "text", icon: "note", color: "none", text: "Pairs nicely with a “name your planet” stamp in the camp passport." },
        ],
      },
    ],
  },
];

let seq = 0;
export function draftId(prefix = "d"): string {
  seq += 1;
  return `${prefix}-${seq.toString(36)}-${Math.floor(performance.now()).toString(36)}`;
}

export function blankBlock(kind: BlockKind): DraftBlock {
  if (kind === "materials") return { id: draftId("b"), kind, items: [""] };
  if (kind === "media") return { id: draftId("b"), kind, text: "", url: "" };
  if (kind === "divider") return { id: draftId("b"), kind };
  if (kind === "number") return { id: draftId("b"), kind, text: "" };
  return { id: draftId("b"), kind: "text", text: "", icon: "none", color: "none" };
}

export function cloneSheet(sheet: DraftSheet): DraftSheet {
  return {
    ...sheet,
    sections: sheet.sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => ({ ...b, items: b.items ? [...b.items] : undefined })) })),
  };
}
