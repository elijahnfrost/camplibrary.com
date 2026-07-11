// Pure structural edits on a RunDoc — the operations the run-sheet editor
// (ActivityRunList) performs when a staffer patches, removes, duplicates, or
// reorders a block or an attached detail. Each takes the current doc and returns
// the NEXT one without mutating the input; there are NO focus / undo / commit
// side effects here (those stay in the component wrapper), which is exactly what
// makes these unit-testable. Extracted verbatim from ActivityRunList so the core
// editing logic has a fast, behavioral safety net independent of the component.
//
// Contract notes (match the component's prior inline behavior):
//   - id-based patch/remove helpers are no-ops (return an equivalent doc) when
//     the target id isn't found — the map/filter simply matches nothing.
//   - moveBlock returns `null` when the block can't move (already at an end or
//     not found), so the caller can skip committing entirely; moveChild always
//     returns a doc (a blocked swap leaves that parent's children untouched).
//   - duplicateChild takes the new child id as an argument (rather than minting
//     one itself) so it stays pure and deterministic for tests.
import { cloneRunChild, type RunBlock, type RunChild, type RunDoc } from "./runList";

// Merge `patch` into the top-level block `id`.
export function patchBlock(doc: RunDoc, id: string, patch: Partial<RunBlock>): RunDoc {
  return { blocks: doc.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

// Merge `patch` into the attached child `kid` under parent block `pid`.
export function patchChild(doc: RunDoc, pid: string, kid: string, patch: Partial<RunChild>): RunDoc {
  return {
    blocks: doc.blocks.map((b) =>
      b.id === pid
        ? { ...b, children: (b.children || []).map((c) => (c.id === kid ? { ...c, ...patch } : c)) }
        : b
    ),
  };
}

// Drop the top-level block `id`.
export function removeBlock(doc: RunDoc, id: string): RunDoc {
  return { blocks: doc.blocks.filter((b) => b.id !== id) };
}

// Drop the attached child `kid` under parent block `pid`.
export function removeChild(doc: RunDoc, pid: string, kid: string): RunDoc {
  return {
    blocks: doc.blocks.map((b) =>
      b.id === pid ? { ...b, children: (b.children || []).filter((c) => c.id !== kid) } : b
    ),
  };
}

// Copy the attached child `kid` in place, right after itself, as `newId` (a deep
// clone via cloneRunChild, so an embedded diagram never shares frames). No-op if
// the parent or child isn't found.
export function duplicateChild(doc: RunDoc, pid: string, kid: string, newId: string): RunDoc {
  return {
    blocks: doc.blocks.map((b) => {
      if (b.id !== pid) return b;
      const children = b.children || [];
      const index = children.findIndex((c) => c.id === kid);
      if (index < 0) return b;
      const copy: RunChild = cloneRunChild(children[index], newId);
      return { ...b, children: [...children.slice(0, index + 1), copy, ...children.slice(index + 1)] };
    }),
  };
}

// Reorder the top-level block `id` by one slot (dir -1 up / +1 down). Returns the
// next doc, or `null` when the block is missing or already at that end (so the
// caller can skip committing — no phantom onChange).
export function moveBlock(doc: RunDoc, id: string, dir: -1 | 1): RunDoc | null {
  const idx = doc.blocks.findIndex((b) => b.id === id);
  const swap = idx + dir;
  if (idx < 0 || swap < 0 || swap >= doc.blocks.length) return null;
  const blocks = [...doc.blocks];
  [blocks[idx], blocks[swap]] = [blocks[swap], blocks[idx]];
  return { blocks };
}

// Reorder the attached child `childId` under `parentId` by one slot. Always
// returns a doc; a blocked swap (missing parent/child or already at an end)
// leaves that parent's children untouched.
export function moveChild(doc: RunDoc, parentId: string, childId: string, dir: -1 | 1): RunDoc {
  return {
    blocks: doc.blocks.map((b) => {
      if (b.id !== parentId) return b;
      const children = [...(b.children || [])];
      const idx = children.findIndex((k) => k.id === childId);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= children.length) return b;
      [children[idx], children[swap]] = [children[swap], children[idx]];
      return { ...b, children };
    }),
  };
}
