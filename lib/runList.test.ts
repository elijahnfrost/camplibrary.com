import { describe, expect, it } from "vitest";
import type { Activity } from "./types";
import type { ActivityPlaybookData } from "./playbooks";
import {
  RUN_CHILD_META,
  RUN_CHILD_TYPES,
  RUN_TOP_LABEL,
  blankDiagramChild,
  buildRunDoc,
  cloneRunDoc,
  detailTagsForActivity,
  detailsBlock,
  detailsHeadingBlock,
  ensureSectionHeadings,
  materialsBlock,
  materialsChild,
  normalizeRunDoc,
  playHeadingBlock,
  promoteMaterialsBlocks,
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
    expect(RUN_CHILD_META.video).toEqual({ label: "Video", placeholder: "paste a YouTube link\u2026" });
    expect(RUN_TOP_LABEL.details).toBe("Specific details");

    const first = runId("x");
    const second = runId("x");
    expect(first).toMatch(/^x-/);
    expect(second).toMatch(/^x-/);
    expect(first).not.toBe(second);

    expect(runPillLabel("video", 2)).toBe("2 videos");
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
});
