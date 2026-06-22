import { describe, expect, it } from "vitest";
import type { Activity } from "./types";
import type { ActivityPlaybookData } from "./playbooks";
import {
  RUN_CHILD_META,
  RUN_CHILD_TYPES,
  RUN_TOP_LABEL,
  blankDiagramChild,
  blankStepBlock,
  buildRunDoc,
  cloneRunChild,
  cloneRunDoc,
  insertBlockAfter,
  insertBlockAt,
  detailTagsForActivity,
  detailsBlock,
  detailsHeadingBlock,
  ensureSectionHeadings,
  materialsBlock,
  materialsChild,
  normalizeRunDoc,
  playHeadingBlock,
  promoteMaterialsBlocks,
  rekeyRunDoc,
  runId,
  runPillLabel,
  type RunDoc,
} from "./runList";

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    title: "Kickball",
    type: "Game",
    place: "Outside",
    ageMin: 6,
    ageMax: 12,
    durationMin: 45,
    groupMin: 4,
    groupMax: 12,
    energy: 2,
    prep: "Low",
    blurb: "",
    materials: ["Cones", " cones "],
    steps: ["Set boundaries", "Play"],
    notes: "Rotate captains",
    safety: "No sliding",
    ages: ["g13", "g46"],
    rating: 4,
    ...overrides,
  };
}

const playbook: ActivityPlaybookData = {
  id: "pb-1",
  activityId: "act-1",
  title: "Kickball playbook",
  summary: "",
  surface: { split: true },
  frames: [{ id: "f1", name: "Setup", caption: "", zones: [], flags: [], players: [], arrows: [] }],
};

function blockSummary(doc: RunDoc): string[] {
  return doc.blocks.map((block) => block.type + ":" + (block.text ?? block.title ?? ""));
}

describe("run list model", () => {
  it("exposes stable UI metadata and factories", () => {
    expect(RUN_CHILD_TYPES).toEqual(["note", "safety", "variation", "substep", "video", "diagram", "materials"]);
    expect(RUN_CHILD_META.video).toEqual({ label: "Media", placeholder: "YouTube, Vimeo, or a link\u2026" });
    expect(RUN_TOP_LABEL.details).toBe("Specific details");

    const first = runId("x");
    const second = runId("x");
    expect(first).toMatch(/^x-/);
    expect(second).toMatch(/^x-/);
    expect(first).not.toBe(second);

    expect(runPillLabel("video", 2)).toBe("2 media");
    expect(runPillLabel("safety", 1)).toBe("safety note");
    expect(runPillLabel("substep", 2)).toBe("2 sub-steps");
    expect(runPillLabel("variation", 1)).toBe("variation");
    expect(runPillLabel("diagram", 2)).toBe("2 diagrams");
    expect(runPillLabel("materials", 3)).toBe("materials");
    expect(runPillLabel("note", 2)).toBe("2 notes");

    expect(blankDiagramChild("a1", "Game")).toMatchObject({
      type: "diagram",
      diagram: { activityId: "a1", title: "Game diagram" },
    });
    expect(materialsChild("a1")).toEqual({ id: "a1-mat", type: "materials" });
    expect(materialsBlock("a1")).toEqual({ id: "a1-mat", type: "materials", children: [] });
  });

  it("builds a runnable document from activity seed data", () => {
    const doc = buildRunDoc(activity(), playbook);

    expect(blockSummary(doc)).toEqual([
      "heading:Details",
      "details:",
      "materials:",
      "heading:How to play",
      "step:Set boundaries",
      "step:Play",
      "heading:Notes & safety",
      "variation:Rotate captains",
      "safety:No sliding",
    ]);
    expect(doc.blocks[4].children).toEqual([{ id: "act-1-diagram", type: "diagram", diagram: playbook }]);
  });

  it("omits optional sections when the activity does not need them", () => {
    expect(buildRunDoc(activity({ materials: [], materialTags: [] })).blocks.some((block) => block.type === "materials")).toBe(
      false
    );
    expect(buildRunDoc(activity({ steps: [], playbook: undefined }), null).blocks.some((block) => block.type === "step")).toBe(
      false
    );
    expect(blockSummary(buildRunDoc(activity({ steps: [], notes: "", safety: "" }), playbook))).toEqual([
      "heading:Details",
      "details:",
      "materials:",
      "heading:How to play",
      "step:Set up",
    ]);
    expect(buildRunDoc(activity({ notes: "", safety: "" })).blocks.some((block) => block.text === "Notes & safety")).toBe(
      false
    );
  });

  it("seeds media, links, sub-steps, and variations into the run doc", () => {
    const doc = buildRunDoc(
      activity({
        steps: ["Set boundaries", "Play"],
        media: [{ title: "Demo", url: "https://youtube.com/results?search_query=x" }],
        links: [{ label: "Source", url: "https://example.com" }],
        variations: ["Bigger groups", "Older kids"],
        subsets: [["Mark the lines", "Pick teams"], ["Keep score"]],
      }),
      null
    );
    const steps = doc.blocks.filter((block) => block.type === "step");
    // First step carries media + link as video details, then its sub-steps.
    expect(steps[0].children).toEqual([
      { id: "act-1-media0", type: "video", title: "Demo", url: "https://youtube.com/results?search_query=x" },
      { id: "act-1-link0", type: "video", title: "Source", url: "https://example.com" },
      { id: "act-1-s0-sub0", type: "substep", text: "Mark the lines" },
      { id: "act-1-s0-sub1", type: "substep", text: "Pick teams" },
    ]);
    expect(steps[1].children).toEqual([{ id: "act-1-s1-sub0", type: "substep", text: "Keep score" }]);
    // Variations close the sheet under their own heading.
    expect(doc.blocks.slice(-3).map((block) => block.type + ":" + (block.text || ""))).toEqual([
      "heading:Variations",
      "variation:Bigger groups",
      "variation:Older kids",
    ]);
  });

  it("derives and refreshes detail and section blocks", () => {
    const base = activity();
    expect(detailTagsForActivity(base).map((tag) => tag.id)).toEqual([
      "place",
      "ages",
      "group",
      "duration",
      "type",
      "energy",
      "prep",
      "rating",
    ]);
    expect(detailTagsForActivity(activity({ energy: 0, rating: 0, prep: "None" })).map((tag) => tag.label)).toContain(
      "No prep"
    );
    expect(detailTagsForActivity(activity({ energy: 0, rating: 0 })).map((tag) => tag.id)).not.toContain("rating");
    expect(detailsBlock(base).id).toBe("act-1-details");
    expect(detailsHeadingBlock(base)).toMatchObject({ id: "act-1-details-heading", text: "Details" });
    expect(playHeadingBlock(base)).toMatchObject({ id: "act-1-play-heading", text: "How to play" });

    const doc = ensureSectionHeadings(base, {
      blocks: [
        materialsBlock("act-1"),
        { id: "step-1", type: "step", text: "Go", children: [] },
      ],
    });
    expect(blockSummary(doc)).toEqual([
      "heading:Details",
      "details:",
      "materials:",
      "heading:How to play",
      "step:Go",
    ]);
    expect(doc.blocks[1].tags?.map((tag) => tag.id)).toContain("rating");
  });

  it("promotes legacy material children into top-level blocks", () => {
    const doc: RunDoc = {
      blocks: [
        { id: "h", type: "heading", text: "How to play", children: [] },
        {
          id: "s",
          type: "step",
          text: "Go",
          children: [
            { id: "legacy-mat", type: "materials" },
            { id: "note-1", type: "note", text: "Bring shade" },
          ],
        },
      ],
    };

    const promoted = promoteMaterialsBlocks(doc);

    expect(blockSummary(promoted)).toEqual(["heading:How to play", "materials:", "step:Go"]);
    expect(promoted.blocks[1].id).toBe("legacy-mat");
    expect(promoted.blocks[2].children).toEqual([{ id: "note-1", type: "note", text: "Bring shade" }]);

    const withTop = promoteMaterialsBlocks({ blocks: [materialsBlock("act-1"), doc.blocks[1]] });
    expect(withTop.blocks.filter((block) => block.type === "materials")).toHaveLength(1);

    const unchanged = { blocks: [{ id: "n", type: "note", text: "ok", children: [] }] } satisfies RunDoc;
    expect(promoteMaterialsBlocks(unchanged)).toBe(unchanged);
  });

  it("normalizes untrusted run list documents without discarding empty overrides", () => {
    expect(normalizeRunDoc(null)).toBeNull();
    expect(normalizeRunDoc({})).toBeNull();
    expect(normalizeRunDoc({ blocks: [] })).toEqual({ blocks: [] });

    const normalized = normalizeRunDoc({
      blocks: [
        { id: "bad", type: "missing" },
        {
          id: "details",
          type: "details",
          tags: [
            { id: "place", label: "Outside", icon: "pin" },
            { id: "custom", label: "Custom", icon: "bad" },
            { id: "empty" },
          ],
          children: [{ id: "bad-child", type: "wat" }],
        },
        {
          id: "step",
          type: "step",
          text: "Go",
          collapsed: true,
          children: [
            { id: "video", type: "video", title: "Watch", url: "https://example.test" },
            { id: "diagram", type: "diagram", diagram: playbook },
            { id: "broken-diagram", type: "diagram", diagram: { frames: [] } },
          ],
        },
        { id: "pb", type: "playbook", title: "Card", meta: "Coach", children: [] },
      ],
    });

    expect(normalized?.blocks).toHaveLength(3);
    expect(normalized?.blocks[0]).toMatchObject({
      id: "details",
      type: "details",
      tags: [
        { id: "place", label: "Outside", icon: "pin" },
        { id: "custom", label: "Custom" },
      ],
    });
    expect(normalized?.blocks[1]).toMatchObject({ id: "step", type: "step", text: "Go", collapsed: true });
    expect(normalized?.blocks[1].children?.map((child) => child.type)).toEqual(["video", "diagram"]);
    expect(normalized?.blocks[2]).toMatchObject({ id: "pb", type: "playbook", title: "Card", meta: "Coach" });
  });

  it("does not duplicate a scaffold heading when it has been renamed", () => {
    const base = activity();
    // Simulate: user renamed "How to play" → "Game flow". The block retains its
    // deterministic id but has new text. ensureSectionHeadings must not insert a
    // second block with the same id.
    const renamedPlay = { id: "act-1-play-heading", type: "heading" as const, text: "Game flow", children: [] as import("./runList").RunChild[] };
    const doc: RunDoc = {
      blocks: [
        detailsHeadingBlock(base),
        detailsBlock(base),
        renamedPlay,
        { id: "step-1", type: "step", text: "Kick off", children: [] },
      ],
    };
    const result = ensureSectionHeadings(base, doc);
    const ids = result.blocks.map((b) => b.id);
    const unique = new Set(ids);
    expect(ids).toHaveLength(unique.size); // no duplicate ids
    const playHeadings = result.blocks.filter((b) => b.id === "act-1-play-heading");
    expect(playHeadings).toHaveLength(1);
    expect(playHeadings[0].text).toBe("Game flow"); // rename preserved

    // Same for renamed "Details" heading.
    const renamedDetails = { id: "act-1-details-heading", type: "heading" as const, text: "Activity info", children: [] as import("./runList").RunChild[] };
    const doc2: RunDoc = {
      blocks: [
        renamedDetails,
        detailsBlock(base),
        { id: "step-1", type: "step", text: "Kick off", children: [] },
      ],
    };
    const result2 = ensureSectionHeadings(base, doc2);
    const ids2 = result2.blocks.map((b) => b.id);
    expect(ids2).toHaveLength(new Set(ids2).size);
    const detailsHeadings = result2.blocks.filter((b) => b.id === "act-1-details-heading");
    expect(detailsHeadings).toHaveLength(1);
    expect(detailsHeadings[0].text).toBe("Activity info"); // rename preserved
  });

  it("clones block and child arrays without mutating the source document", () => {
    const source: RunDoc = {
      blocks: [{ id: "s", type: "step", text: "Start", children: [{ id: "n", type: "note", text: "Original" }] }],
    };
    const clone = cloneRunDoc(source);

    clone.blocks[0].text = "Changed";
    clone.blocks[0].children![0].text = "Changed child";

    expect(source.blocks[0].text).toBe("Start");
    expect(source.blocks[0].children![0].text).toBe("Original");
  });

  it("rekeys a run doc onto a new activity without sharing any block identity", () => {
    const source: RunDoc = {
      blocks: [
        { id: "act-1-details-heading", type: "heading", text: "Details", children: [] },
        { id: "act-1-details", type: "details", tags: [], children: [] },
        { id: "rb-3-x", type: "step", text: "Play", children: [{ id: "k-9", type: "note", text: "Tip" }] },
      ],
    };
    const copy = rekeyRunDoc(source, "act-1", "act-2");

    // Derived -details ids carry the NEW prefix so section detection still works.
    expect(copy.blocks[0].id).toBe("act-2-details-heading");
    expect(copy.blocks[1].id).toBe("act-2-details");
    // Non-derived ids are reissued fresh (no source prefix to carry).
    expect(copy.blocks[2].id).not.toBe("rb-3-x");
    // Every child id is fresh.
    expect(copy.blocks[2].children![0].id).not.toBe("k-9");
    // The two docs share NO block or child id — the collision the helper guards.
    const sourceIds = new Set<string>();
    source.blocks.forEach((b) => {
      sourceIds.add(b.id);
      (b.children || []).forEach((c) => sourceIds.add(c.id));
    });
    copy.blocks.forEach((b) => {
      expect(sourceIds.has(b.id)).toBe(false);
      (b.children || []).forEach((c) => expect(sourceIds.has(c.id)).toBe(false));
    });
    // Content is preserved.
    expect(copy.blocks[2].text).toBe("Play");
    expect(copy.blocks[2].children![0].text).toBe("Tip");
  });
});

describe("insertBlockAfter / insertBlockAt", () => {
  const base: RunDoc = {
    blocks: [
      { id: "a", type: "step", text: "First", children: [] },
      { id: "b", type: "step", text: "Second", children: [] },
    ],
  };

  it("inserts immediately after the anchor", () => {
    const fresh = blankStepBlock();
    const next = insertBlockAfter(base, "a", fresh);
    expect(next.blocks.map((b) => b.id)).toEqual(["a", fresh.id, "b"]);
    expect(base.blocks).toHaveLength(2); // source untouched
  });

  it("patches the anchor in the same operation (Enter-to-split)", () => {
    const fresh = blankStepBlock();
    const next = insertBlockAfter(base, "a", fresh, { text: "First, committed" });
    expect(next.blocks[0].text).toBe("First, committed");
    expect(next.blocks[1].id).toBe(fresh.id);
  });

  it("appends when the anchor id is unknown", () => {
    const fresh = blankStepBlock();
    const next = insertBlockAfter(base, "missing", fresh);
    expect(next.blocks.map((b) => b.id)).toEqual(["a", "b", fresh.id]);
  });

  it("inserts at a clamped top-level index", () => {
    const fresh = blankStepBlock();
    expect(insertBlockAt(base, 0, fresh).blocks[0].id).toBe(fresh.id);
    expect(insertBlockAt(base, 99, fresh).blocks[2].id).toBe(fresh.id);
    expect(insertBlockAt(base, -5, fresh).blocks[0].id).toBe(fresh.id);
  });
});

describe("cloneRunChild — diagram independence", () => {
  it("deep-clones an embedded diagram so a copy never shares frames with the source", () => {
    const original = blankDiagramChild("act-1", "Kickball");
    const copy = cloneRunChild(original, "fresh-id");

    expect(copy.id).toBe("fresh-id");
    expect(copy.diagram).not.toBe(original.diagram); // different object reference
    expect(copy.diagram?.frames).not.toBe(original.diagram?.frames);
    expect(copy.diagram?.frames[0]).not.toBe(original.diagram?.frames[0]);

    // Mutating the copy's diagram must not bleed into the original.
    copy.diagram!.frames[0].name = "CHANGED";
    expect(original.diagram?.frames[0].name).not.toBe("CHANGED");
  });

  it("preserves the source id when none is given (id-preserving clone)", () => {
    const original = blankDiagramChild("act-1", "Kickball");
    expect(cloneRunChild(original).id).toBe(original.id);
  });

  it("cloneRunDoc deep-clones diagram children", () => {
    const doc: RunDoc = {
      blocks: [{ id: "s1", type: "step", text: "Set up", children: [blankDiagramChild("act-1", "Kickball")] }],
    };
    const clone = cloneRunDoc(doc);
    expect(clone.blocks[0].children?.[0].diagram).not.toBe(doc.blocks[0].children?.[0].diagram);
  });
});
