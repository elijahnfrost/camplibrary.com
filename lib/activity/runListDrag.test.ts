import { describe, expect, it } from "vitest";
import {
  applyDrop,
  resolveDrop,
  type DragItem,
  type DropTarget,
  type RunBlock,
  type RunDoc,
} from "./runList";

// h (heading) · s1 (expanded step, child c1 note) · n1 (top-level note)
function doc(): RunDoc {
  return {
    blocks: [
      { id: "h", type: "heading", text: "Setup", children: [] },
      {
        id: "s1",
        type: "step",
        text: "Do it",
        collapsed: false,
        children: [{ id: "c1", type: "note", text: "inner note" }],
      },
      { id: "n1", type: "note", text: "loose note", children: [] },
    ],
  };
}

const top = (id: string): DragItem => ({ kind: "top", id });
const child = (parentId: string, id: string): DragItem => ({ kind: "child", parentId, id });
const target = (item: DragItem, position: "before" | "after"): DropTarget => ({ item, position });
const ids = (blocks: RunBlock[]) => blocks.map((b) => b.id);

describe("resolveDrop — placement rules", () => {
  it("never nests a block into a heading — only reorders at top level", () => {
    const d = resolveDrop(top("n1"), target(top("h"), "after"), doc().blocks);
    expect(d).toEqual({ scope: "top", targetId: "h", position: "after" });
  });

  it("dropping after an EXPANDED step stays top-level (no accidental nesting)", () => {
    // This is the old footgun: 'after an open step' used to auto-nest as a child.
    const d = resolveDrop(top("n1"), target(top("s1"), "after"), doc().blocks);
    expect(d).toEqual({ scope: "top", targetId: "s1", position: "after" });
  });

  it("nests only when dropped directly onto an existing detail row", () => {
    const d = resolveDrop(top("n1"), target(child("s1", "c1"), "before"), doc().blocks);
    expect(d).toEqual({ scope: "children", parentId: "s1", targetChildId: "c1", position: "before" });
  });

  it("refuses to nest a step (not detail-capable) onto a child row", () => {
    expect(resolveDrop(top("s1"), target(child("s1", "c1"), "after"), doc().blocks)).toBeNull();
  });

  it("returns null for a no-op drop on itself", () => {
    expect(resolveDrop(top("n1"), target(top("n1"), "before"), doc().blocks)).toBeNull();
  });
});

describe("applyDrop — block movement", () => {
  it("reorders a top-level block without changing nesting", () => {
    const dest = resolveDrop(top("n1"), target(top("s1"), "after"), doc().blocks)!;
    const next = applyDrop(doc().blocks, top("n1"), dest)!;
    expect(ids(next)).toEqual(["h", "s1", "n1"]);
    // s1 keeps its single child — n1 did not get sucked in.
    expect(next.find((b) => b.id === "s1")?.children?.map((c) => c.id)).toEqual(["c1"]);
  });

  it("nests a top-level note under a step as a detail when dropped on a child", () => {
    const dest = resolveDrop(top("n1"), target(child("s1", "c1"), "before"), doc().blocks)!;
    const next = applyDrop(doc().blocks, top("n1"), dest)!;
    expect(ids(next)).toEqual(["h", "s1"]);
    const kids = next.find((b) => b.id === "s1")?.children || [];
    expect(kids.map((c) => c.id)).toEqual(["n1", "c1"]);
    expect(kids[0].type).toBe("note");
  });

  it("promotes a detail to a top-level block when dropped on a top-level row", () => {
    const dest = resolveDrop(child("s1", "c1"), target(top("n1"), "after"), doc().blocks)!;
    const next = applyDrop(doc().blocks, child("s1", "c1"), dest)!;
    expect(ids(next)).toEqual(["h", "s1", "n1", "c1"]);
    expect(next.find((b) => b.id === "s1")?.children).toEqual([]);
    expect(next.find((b) => b.id === "c1")?.type).toBe("note");
  });
});
