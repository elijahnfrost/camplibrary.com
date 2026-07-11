import { describe, it, expect } from "vitest";
import {
  patchBlock,
  patchChild,
  removeBlock,
  removeChild,
  duplicateChild,
  moveBlock,
  moveChild,
} from "./runDocOps";
import type { RunBlock, RunChild, RunDoc } from "./runList";

const child = (id: string, text = id): RunChild => ({ id, type: "note", text });
const block = (id: string, children: RunChild[] = []): RunBlock => ({ id, type: "step", text: id, children });
const doc = (...blocks: RunBlock[]): RunDoc => ({ blocks });

describe("runDocOps — pure structural edits", () => {
  it("patchBlock merges into the target only, and never mutates the input", () => {
    const before = doc(block("a"), block("b"));
    const after = patchBlock(before, "a", { text: "renamed", collapsed: true });
    expect(after.blocks[0]).toMatchObject({ id: "a", text: "renamed", collapsed: true });
    expect(after.blocks[1]).toEqual(before.blocks[1]);
    // input untouched
    expect(before.blocks[0].text).toBe("a");
    expect(before.blocks[0]).not.toBe(after.blocks[0]);
  });

  it("patchBlock is a no-op for an unknown id", () => {
    const before = doc(block("a"));
    expect(patchBlock(before, "zzz", { text: "x" })).toEqual(before);
  });

  it("patchChild merges into the target child under its parent", () => {
    const before = doc(block("a", [child("k1"), child("k2")]));
    const after = patchChild(before, "a", "k2", { text: "edited" });
    expect(after.blocks[0].children).toEqual([child("k1"), { ...child("k2"), text: "edited" }]);
    // untouched parent / wrong child
    expect(patchChild(before, "a", "nope", { text: "x" })).toEqual(before);
    expect(patchChild(before, "nope", "k2", { text: "x" })).toEqual(before);
  });

  it("removeBlock drops the target and no-ops on an unknown id", () => {
    const before = doc(block("a"), block("b"), block("c"));
    expect(removeBlock(before, "b").blocks.map((b) => b.id)).toEqual(["a", "c"]);
    expect(removeBlock(before, "zzz")).toEqual(before);
  });

  it("removeChild drops the target child, leaving siblings and other blocks", () => {
    const before = doc(block("a", [child("k1"), child("k2")]), block("b", [child("k3")]));
    const after = removeChild(before, "a", "k1");
    expect(after.blocks[0].children).toEqual([child("k2")]);
    expect(after.blocks[1]).toEqual(before.blocks[1]);
    expect(removeChild(before, "a", "nope")).toEqual(before);
  });

  it("duplicateChild inserts a deep clone right after the source with the given id", () => {
    const before = doc(block("a", [child("k1", "hello"), child("k2")]));
    const after = duplicateChild(before, "a", "k1", "k1-copy");
    const kids = after.blocks[0].children!;
    expect(kids.map((k) => k.id)).toEqual(["k1", "k1-copy", "k2"]);
    expect(kids[1]).toMatchObject({ id: "k1-copy", text: "hello" });
    // a distinct object, not the source reference
    expect(kids[1]).not.toBe(kids[0]);
    // no-op when the parent or child is missing
    expect(duplicateChild(before, "a", "nope", "x")).toEqual(before);
    expect(duplicateChild(before, "nope", "k1", "x")).toEqual(before);
  });

  it("moveBlock swaps by one slot, and returns null at the ends / when missing", () => {
    const before = doc(block("a"), block("b"), block("c"));
    expect(moveBlock(before, "b", -1)!.blocks.map((b) => b.id)).toEqual(["b", "a", "c"]);
    expect(moveBlock(before, "b", 1)!.blocks.map((b) => b.id)).toEqual(["a", "c", "b"]);
    expect(moveBlock(before, "a", -1)).toBeNull(); // already first
    expect(moveBlock(before, "c", 1)).toBeNull(); // already last
    expect(moveBlock(before, "zzz", 1)).toBeNull(); // missing
    // no mutation of the input
    expect(before.blocks.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("moveChild swaps a child by one slot and leaves the parent untouched at the ends", () => {
    const before = doc(block("a", [child("k1"), child("k2"), child("k3")]));
    expect(moveChild(before, "a", "k2", -1).blocks[0].children!.map((k) => k.id)).toEqual(["k2", "k1", "k3"]);
    expect(moveChild(before, "a", "k2", 1).blocks[0].children!.map((k) => k.id)).toEqual(["k1", "k3", "k2"]);
    // blocked swaps leave that parent's children in original order
    expect(moveChild(before, "a", "k1", -1).blocks[0].children!.map((k) => k.id)).toEqual(["k1", "k2", "k3"]);
    expect(moveChild(before, "a", "k3", 1).blocks[0].children!.map((k) => k.id)).toEqual(["k1", "k2", "k3"]);
    expect(moveChild(before, "a", "nope", 1).blocks[0].children!.map((k) => k.id)).toEqual(["k1", "k2", "k3"]);
  });
});
