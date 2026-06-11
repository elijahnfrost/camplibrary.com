import { describe, expect, it } from "vitest";
import { buildPresentSlides, slideFrameCount, type PresentSlide } from "./presentSlides";
import type { RunDoc } from "./runList";
import type { Activity } from "./types";

const ACTIVITY: Activity = {
  id: "ctf",
  title: "Capture the Flag",
  type: "Game",
  place: "Outside",
  ageMin: 6,
  ageMax: 12,
  durationMin: 30,
  groupMin: 10,
  groupMax: 30,
  energy: 3,
  prep: "Low",
  blurb: "Classic wide game",
  materials: ["Flags"],
  steps: [],
  notes: "",
  safety: "",
  ages: ["g13"],
  rating: 4,
};

const DIAGRAM = {
  id: "pb",
  activityId: "ctf",
  title: "CTF",
  summary: "",
  frames: [
    { id: "f1", name: "Setup", caption: "", zones: [], flags: [], players: [], arrows: [] },
    { id: "f2", name: "Raid", caption: "", zones: [], flags: [], players: [], arrows: [] },
    { id: "f3", name: "Return", caption: "", zones: [], flags: [], players: [], arrows: [] },
  ],
};

function doc(blocks: RunDoc["blocks"]): RunDoc {
  return { blocks };
}

describe("buildPresentSlides", () => {
  it("starts with a title slide carrying the activity tags", () => {
    const slides = buildPresentSlides(ACTIVITY, doc([]));
    expect(slides[0]).toMatchObject({ kind: "title", title: "Capture the Flag", blurb: "Classic wide game" });
    expect((slides[0] as Extract<PresentSlide, { kind: "title" }>).tags.length).toBeGreaterThan(3);
  });

  it("maps steps to slides with bullets and a diagram hero", () => {
    const slides = buildPresentSlides(
      ACTIVITY,
      doc([
        { id: "h1", type: "heading", text: "How to play", children: [] },
        {
          id: "s1",
          type: "step",
          text: "Split the field",
          children: [
            { id: "k1", type: "safety", text: "Mark boundaries" },
            { id: "k2", type: "diagram", diagram: DIAGRAM },
            { id: "k3", type: "note", text: "" },
          ],
        },
        { id: "s2", type: "step", text: "Play!", children: [] },
      ])
    );
    expect(slides.map((s) => s.kind)).toEqual(["title", "section", "step", "step"]);
    const step = slides[2] as Extract<PresentSlide, { kind: "step" }>;
    expect(step.number).toBe(1);
    expect(step.bullets).toHaveLength(1);
    expect(step.diagram?.frames).toHaveLength(3);
  });

  it("emits a single materials slide and skips empties/legacy blocks", () => {
    const slides = buildPresentSlides(
      ACTIVITY,
      doc([
        { id: "d", type: "details", children: [] },
        { id: "h", type: "heading", text: "Details", children: [] },
        { id: "m1", type: "materials", children: [] },
        { id: "s1", type: "step", text: "Go", children: [{ id: "mm", type: "materials" }] },
        { id: "pb", type: "playbook", title: "x", meta: "", children: [] },
        { id: "n0", type: "note", text: "   ", children: [] },
        { id: "n1", type: "safety", text: "Buddy system", children: [] },
      ])
    );
    expect(slides.map((s) => s.kind)).toEqual(["title", "materials", "step", "note"]);
  });

  it("skips contentless steps but keeps diagram-only steps", () => {
    const slides = buildPresentSlides(
      ACTIVITY,
      doc([
        { id: "s1", type: "step", text: "", children: [] },
        { id: "s2", type: "step", text: "", children: [{ id: "k", type: "diagram", diagram: DIAGRAM }] },
      ])
    );
    expect(slides.map((s) => s.kind)).toEqual(["title", "step"]);
  });
});

describe("slideFrameCount", () => {
  it("gives multi-frame diagram steps one tap per frame", () => {
    const slides = buildPresentSlides(
      ACTIVITY,
      doc([
        { id: "s1", type: "step", text: "Setup", children: [{ id: "k", type: "diagram", diagram: DIAGRAM }] },
        { id: "s2", type: "step", text: "Play", children: [] },
      ])
    );
    expect(slideFrameCount(slides[1])).toBe(3);
    expect(slideFrameCount(slides[2])).toBe(1);
    expect(slideFrameCount(slides[0])).toBe(1);
  });
});
