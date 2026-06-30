// Pure block-movement rules for the draft run sheet. Kept separate from the
// view so the placement logic stays predictable (and easy to reason about):
// every block belongs to exactly one section, a block may sit at depth 0
// (top-level in its section) or depth 1 (a detail nested under the nearest
// preceding step), and a move is just remove-then-insert followed by a
// normalize pass that repairs any impossible nesting.

import type { DraftBlock, DraftSection, DraftSheet } from "./seed";

export type DropPos = "before" | "after";

// Where a dragged block wants to land.
export type BlockDrop =
  | { kind: "block"; targetId: string; pos: DropPos; nest: boolean }
  | { kind: "section-start"; sectionId: string }
  | { kind: "section-empty"; sectionId: string };

function locate(sections: DraftSection[], blockId: string): { s: number; b: number } | null {
  for (let s = 0; s < sections.length; s += 1) {
    const b = sections[s].blocks.findIndex((x) => x.id === blockId);
    if (b >= 0) return { s, b };
  }
  return null;
}

// A sub-block (depth 1) is only legal when a depth-0 block precedes it in the
// same run (a divider ends the run). This isn't a TYPE limiter — any kind can be
// a sub-block — it just keeps a sub-block from being the very first thing with
// nothing to sit under. Anything orphaned is pulled back to depth 0.
export function normalizeSection(section: DraftSection): DraftSection {
  let hasParent = false;
  const blocks = section.blocks.map((b) => {
    if (b.kind === "divider") {
      hasParent = false;
      return b.depth ? { ...b, depth: 0 as const } : b;
    }
    const wantsNest = (b.depth ?? 0) >= 1;
    if (wantsNest && hasParent) return b.depth === 1 ? b : { ...b, depth: 1 as const };
    hasParent = true;
    return b.depth ? { ...b, depth: 0 as const } : b;
  });
  return { ...section, blocks };
}

// Tab / Shift-Tab: make any block a sub-block or pull it back to the spine.
export function setDepth(sheet: DraftSheet, blockId: string, depth: 0 | 1): DraftSheet {
  return normalizeSheet(patchBlock(sheet, blockId, { depth }));
}

export function normalizeSheet(sheet: DraftSheet): DraftSheet {
  return { ...sheet, sections: sheet.sections.map(normalizeSection) };
}

function removeBlock(
  sections: DraftSection[],
  blockId: string
): { sections: DraftSection[]; block: DraftBlock | null } {
  const at = locate(sections, blockId);
  if (!at) return { sections, block: null };
  const block = sections[at.s].blocks[at.b];
  const next = sections.map((sec, s) =>
    s === at.s ? { ...sec, blocks: sec.blocks.filter((x) => x.id !== blockId) } : sec
  );
  return { sections: next, block };
}

// Move `sourceId` to a resolved drop. Returns the same sheet on a no-op or a
// stale target. Always normalized so depth can't end up invalid.
export function moveBlock(sheet: DraftSheet, sourceId: string, drop: BlockDrop): DraftSheet {
  if (drop.kind === "block" && drop.targetId === sourceId) return sheet;

  const removed = removeBlock(sheet.sections, sourceId);
  if (!removed.block) return sheet;
  const moving = removed.block;
  let sections = removed.sections;

  if (drop.kind === "section-start" || drop.kind === "section-empty") {
    sections = sections.map((sec) =>
      sec.id === drop.sectionId ? { ...sec, blocks: [{ ...moving, depth: 0 as const }, ...sec.blocks] } : sec
    );
    return normalizeSheet({ ...sheet, sections });
  }

  const at = locate(sections, drop.targetId);
  if (!at) return sheet; // target vanished (it was the source's only neighbour) — bail
  const insertAt = drop.pos === "before" ? at.b : at.b + 1;
  const placed: DraftBlock = { ...moving, depth: drop.nest ? 1 : 0 };
  sections = sections.map((sec, s) => {
    if (s !== at.s) return sec;
    const blocks = [...sec.blocks];
    blocks.splice(insertAt, 0, placed);
    return { ...sec, blocks };
  });
  return normalizeSheet({ ...sheet, sections });
}

// Reorder whole sections (dragging a section by its header).
export function moveSection(sheet: DraftSheet, sourceId: string, targetId: string, pos: DropPos): DraftSheet {
  if (sourceId === targetId) return sheet;
  const from = sheet.sections.findIndex((s) => s.id === sourceId);
  if (from < 0) return sheet;
  const without = sheet.sections.filter((s) => s.id !== sourceId);
  const targetIdx = without.findIndex((s) => s.id === targetId);
  if (targetIdx < 0) return sheet;
  const insertAt = pos === "before" ? targetIdx : targetIdx + 1;
  const sections = [...without];
  sections.splice(insertAt, 0, sheet.sections[from]);
  return { ...sheet, sections };
}

// Patch one block in place.
export function patchBlock(sheet: DraftSheet, blockId: string, patch: Partial<DraftBlock>): DraftSheet {
  return {
    ...sheet,
    sections: sheet.sections.map((sec) => ({
      ...sec,
      blocks: sec.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
    })),
  };
}

export function removeBlockById(sheet: DraftSheet, blockId: string): DraftSheet {
  return normalizeSheet({ ...sheet, sections: removeBlock(sheet.sections, blockId).sections });
}

// Insert a fresh block immediately after `afterId` (same section), or at the
// end of `sectionId` when no anchor is given. Used by the "+" affordance.
export function insertBlock(
  sheet: DraftSheet,
  block: DraftBlock,
  where: { afterId: string } | { sectionId: string }
): DraftSheet {
  if ("afterId" in where) {
    const at = locate(sheet.sections, where.afterId);
    if (!at) return sheet;
    const anchor = sheet.sections[at.s].blocks[at.b];
    const placed = { ...block, depth: (anchor.depth ?? 0) as 0 | 1 };
    const sections = sheet.sections.map((sec, s) => {
      if (s !== at.s) return sec;
      const blocks = [...sec.blocks];
      blocks.splice(at.b + 1, 0, placed);
      return { ...sec, blocks };
    });
    return normalizeSheet({ ...sheet, sections });
  }
  const sections = sheet.sections.map((sec) =>
    sec.id === where.sectionId ? { ...sec, blocks: [...sec.blocks, { ...block, depth: 0 as const }] } : sec
  );
  return normalizeSheet({ ...sheet, sections });
}

export function duplicateBlock(sheet: DraftSheet, blockId: string, newId: string): DraftSheet {
  const at = locate(sheet.sections, blockId);
  if (!at) return sheet;
  const src = sheet.sections[at.s].blocks[at.b];
  const copy: DraftBlock = { ...src, id: newId, items: src.items ? [...src.items] : undefined };
  const sections = sheet.sections.map((sec, s) => {
    if (s !== at.s) return sec;
    const blocks = [...sec.blocks];
    blocks.splice(at.b + 1, 0, copy);
    return { ...sec, blocks };
  });
  return { ...sheet, sections };
}
