import { describe, expect, it } from "vitest";
import { buildRunDoc } from "@/lib/runList";
import type { RunDoc } from "@/lib/runList";
import type { Activity } from "@/lib/types";
import { hasSummaryContent, summarizeRunDoc } from "./runSummary";

const activity: Activity = {
  id: "test",
  title: "Capture the Flag",
  type: "Game",
  place: "Outside",
  ageMin: 8,
  ageMax: 12,
  durationMin: 30,
  groupMin: 10,
  groupMax: 30,
  energy: 3,
  prep: "Low",
  blurb: "Two teams, two flags.",
  materials: ["2 flags", "8 cones"],
  materialTags: ["Flags", "Cones"],
  steps: ["Split the field in half.", "Grab the enemy flag."],
  notes: "Add a second flag for big groups.",
  safety: "Set hard boundary lines.",
  ages: ["g46"],
  rating: 5,
};

describe("summarizeRunDoc", () => {
  it("pulls steps, safety and materials from a derived doc", () => {
    const doc = buildRunDoc(activity);
    const summary = summarizeRunDoc(activity, doc);
    expect(summary.steps).toEqual(["Split the field in half.", "Grab the enemy flag."]);
    expect(summary.safety).toContain("Set hard boundary lines.");
    expect(summary.materials).toEqual(["Flags", "Cones"]);
    expect(summary.hasDiagram).toBe(false);
    expect((summary as unknown as Record<string, unknown>).notes).toBeUndefined();
  });

  it("prefixes a step's time/cue chip when present", () => {
    const doc: RunDoc = {
      blocks: [
        { id: "s1", type: "step", text: "Gather the group", time: "0:00 · setup" },
        { id: "s2", type: "step", text: "" }, // empty steps are skipped
      ],
    };
    const summary = summarizeRunDoc(activity, doc);
    expect(summary.steps).toEqual(["0:00 · setup — Gather the group"]);
  });

  it("collects safety from step children and flags diagrams", () => {
    const doc: RunDoc = {
      blocks: [
        {
          id: "s1",
          type: "step",
          text: "Set up",
          children: [
            { id: "k1", type: "safety", text: "Mind the slope" },
            { id: "k2", type: "note", text: "Pre-soak shirts" },
            {
              id: "k3",
              type: "diagram",
              diagram: { id: "d1", activityId: "test", title: "x", summary: "", frames: [] },
            },
          ],
        },
      ],
    };
    const summary = summarizeRunDoc(activity, doc);
    expect(summary.safety).toContain("Mind the slope");
    expect(summary.hasDiagram).toBe(true);
  });

  it("hasSummaryContent is false for an empty doc", () => {
    const empty: Activity = { ...activity, materials: [], materialTags: [], steps: [], notes: "", safety: "" };
    const summary = summarizeRunDoc(empty, { blocks: [] });
    expect(hasSummaryContent(summary)).toBe(false);
  });

  it("hasSummaryContent is true when only a diagram is present (print-13)", () => {
    // A doc whose ONLY content is a diagram (no steps/safety/materials) must
    // still report "has content" — otherwise EventTldr renders a fully empty
    // block for it (the bug print-13 fixes).
    const empty: Activity = { ...activity, materials: [], materialTags: [], steps: [], notes: "", safety: "" };
    const doc: RunDoc = {
      blocks: [
        {
          id: "s1",
          type: "step",
          text: "",
          children: [
            {
              id: "k1",
              type: "diagram",
              diagram: { id: "d1", activityId: "test", title: "x", summary: "", frames: [] },
            },
          ],
        },
      ],
    };
    const summary = summarizeRunDoc(empty, doc);
    expect(summary.steps).toEqual([]);
    expect(summary.hasDiagram).toBe(true);
    expect(hasSummaryContent(summary)).toBe(true);
  });

  it("does not count notes/variations toward hasSummaryContent (they never render)", () => {
    const empty: Activity = { ...activity, materials: [], materialTags: [], steps: [], notes: "", safety: "" };
    const doc: RunDoc = {
      blocks: [{ id: "n1", type: "note", text: "Some standalone note with no other content" }],
    };
    const summary = summarizeRunDoc(empty, doc);
    expect(hasSummaryContent(summary)).toBe(false);
  });
});
