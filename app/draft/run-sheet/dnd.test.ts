import { describe, expect, it } from "vitest";
import type { DraftSheet } from "./seed";
import { insertBlock, moveBlock, moveSection, normalizeSection } from "./dnd";

// A → [s1(number), s1a(text sub), n1(text)] · B → [s2(number)]
function sheet(): DraftSheet {
  return {
    id: "t",
    name: "T",
    meta: "",
    sections: [
      {
        id: "A",
        title: "A",
        blocks: [
          { id: "s1", kind: "number", text: "one" },
          { id: "s1a", kind: "text", text: "detail", depth: 1 },
          { id: "n1", kind: "text", text: "loose" },
        ],
      },
      { id: "B", title: "B", blocks: [{ id: "s2", kind: "number", text: "two" }] },
    ],
  };
}

const ids = (s: DraftSheet, sec: string) => s.sections.find((x) => x.id === sec)!.blocks.map((b) => b.id);
const depthOf = (s: DraftSheet, id: string) =>
  s.sections.flatMap((x) => x.blocks).find((b) => b.id === id)?.depth ?? 0;

describe("normalizeSection — depth repair", () => {
  it("pulls a leading sub-block back to top level (no parent above it)", () => {
    const out = normalizeSection({ id: "x", title: "x", blocks: [{ id: "a", kind: "text", depth: 1 }] });
    expect(out.blocks[0].depth).toBe(0);
  });
  it("keeps a sub-block under a preceding block", () => {
    const out = normalizeSection({
      id: "x",
      title: "x",
      blocks: [{ id: "p", kind: "number" }, { id: "c", kind: "text", depth: 1 }],
    });
    expect(out.blocks[1].depth).toBe(1);
  });
  it("a divider ends the run, so the next sub-block outdents", () => {
    const out = normalizeSection({
      id: "x",
      title: "x",
      blocks: [{ id: "p", kind: "number" }, { id: "d", kind: "divider" }, { id: "c", kind: "text", depth: 1 }],
    });
    expect(out.blocks[2].depth).toBe(0);
  });
});

describe("moveBlock", () => {
  it("reorders within a section without touching nesting elsewhere", () => {
    const out = moveBlock(sheet(), "n1", { kind: "block", targetId: "s1", pos: "before", nest: false });
    expect(ids(out, "A")).toEqual(["n1", "s1", "s1a"]);
    expect(depthOf(out, "s1a")).toBe(1); // s1a stays nested under s1
  });

  it("nests a top-level block under the step above when dropped with nest=true", () => {
    const out = moveBlock(sheet(), "n1", { kind: "block", targetId: "s1a", pos: "after", nest: true });
    expect(ids(out, "A")).toEqual(["s1", "s1a", "n1"]);
    expect(depthOf(out, "n1")).toBe(1);
  });

  it("moves a block into another section at its start", () => {
    const out = moveBlock(sheet(), "n1", { kind: "section-start", sectionId: "B" });
    expect(ids(out, "A")).toEqual(["s1", "s1a"]);
    expect(ids(out, "B")).toEqual(["n1", "s2"]);
    expect(depthOf(out, "n1")).toBe(0);
  });

  it("is a no-op when dropped onto itself", () => {
    const out = moveBlock(sheet(), "n1", { kind: "block", targetId: "n1", pos: "after", nest: false });
    expect(out).toEqual(sheet());
  });
});

describe("moveSection", () => {
  it("reorders whole sections", () => {
    const out = moveSection(sheet(), "B", "A", "before");
    expect(out.sections.map((s) => s.id)).toEqual(["B", "A"]);
  });
});

describe("insertBlock", () => {
  it("inherits the anchor's depth when inserted after it", () => {
    const out = insertBlock(sheet(), { id: "new", kind: "text" }, { afterId: "s1a" });
    expect(depthOf(out, "new")).toBe(1); // dropped right after a sub-block → also a sub-block
  });
  it("appends a top-level block at the end of a section", () => {
    const out = insertBlock(sheet(), { id: "new", kind: "number" }, { sectionId: "B" });
    expect(ids(out, "B")).toEqual(["s2", "new"]);
    expect(depthOf(out, "new")).toBe(0);
  });
});
