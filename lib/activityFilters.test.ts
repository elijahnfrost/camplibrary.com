import { describe, expect, it } from "vitest";
import { matchesActivityFilters, type ActivityFilterState } from "./activityFilters";
import type { Activity } from "./types";

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "a1",
    title: "Base game",
    type: "Game",
    place: "Inside",
    ageMin: 6,
    ageMax: 9,
    durationMin: 30,
    groupMin: null,
    groupMax: null,
    energy: 1,
    prep: "None",
    blurb: "Base blurb",
    materials: [],
    steps: [],
    notes: "",
    safety: "",
    ages: ["g13"],
    rating: 0,
    ...overrides,
  };
}

const allFilters: ActivityFilterState = {
  cat: "All",
  place: "All",
  age: "All",
  query: "",
  availableMaterialTags: [],
};

function filters(overrides: Partial<ActivityFilterState> = {}): ActivityFilterState {
  return { ...allFilters, ...overrides };
}

describe("activity filters", () => {
  it("filters by category", () => {
    expect(matchesActivityFilters(activity({ type: "Game" }), filters({ cat: "Game" }))).toBe(true);
    expect(matchesActivityFilters(activity({ type: "Craft" }), filters({ cat: "Game" }))).toBe(false);
  });

  it("filters by inside and outside placement while accepting Both", () => {
    expect(matchesActivityFilters(activity({ place: "Inside" }), filters({ place: "Inside" }))).toBe(true);
    expect(matchesActivityFilters(activity({ place: "Both" }), filters({ place: "Inside" }))).toBe(true);
    expect(matchesActivityFilters(activity({ place: "Outside" }), filters({ place: "Inside" }))).toBe(false);

    expect(matchesActivityFilters(activity({ place: "Outside" }), filters({ place: "Outside" }))).toBe(true);
    expect(matchesActivityFilters(activity({ place: "Both" }), filters({ place: "Outside" }))).toBe(true);
    expect(matchesActivityFilters(activity({ place: "Inside" }), filters({ place: "Outside" }))).toBe(false);
  });

  it("filters by age group membership", () => {
    expect(matchesActivityFilters(activity({ ages: ["g13", "g46"] }), filters({ age: "g46" }))).toBe(true);
    expect(matchesActivityFilters(activity({ ages: ["g13"] }), filters({ age: "g46" }))).toBe(false);
  });

  it("composes material availability with other filters", () => {
    const base = activity({ type: "Game", materials: ["Cones", "Rope"] });

    expect(matchesActivityFilters(base, filters({ availableMaterialTags: undefined }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ availableMaterialTags: [] }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ availableMaterialTags: ["cones"] }))).toBe(false);
    expect(matchesActivityFilters(base, filters({ availableMaterialTags: ["cones", "rope"] }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ cat: "Craft", availableMaterialTags: ["cones", "rope"] }))).toBe(false);
  });

  it("searches visible activity text case-insensitively", () => {
    const base = activity({
      title: "River Relay",
      type: "Water",
      place: "Outside",
      blurb: "Pass a sponge down the line",
      materials: ["Buckets", "Sponges"],
    });

    expect(matchesActivityFilters(base, filters({ query: " river " }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "water" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "outside" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "SPONGE" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "missing" }))).toBe(false);
  });

  it("searches material tags shown in material filters and checklists", () => {
    const base = activity({
      title: "Nature journaling",
      materials: ["Notebook or paper per camper", "Pencil per camper"],
      materialTags: ["Notebook or paper", "Pencils", "Clipboards"],
    });

    expect(matchesActivityFilters(base, filters({ query: "pencils" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "clipboard" }))).toBe(true);
  });

  it("searches step and note text so play details are findable", () => {
    const base = activity({
      title: "Plain title",
      blurb: "Plain blurb",
      notes: "Works well after lunch",
      steps: ["Line campers up behind the sponge line"],
    });

    expect(matchesActivityFilters(base, filters({ query: "sponge line" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "after lunch" }))).toBe(true);
  });

  it("does not search hidden implementation fields", () => {
    const base = activity({
      id: "needle-id",
      title: "Plain title",
      blurb: "Plain blurb",
      materials: ["Rope"],
      safety: "safety-needle",
    });

    expect(matchesActivityFilters(base, filters({ query: "needle" }))).toBe(false);
    expect(matchesActivityFilters(base, filters({ query: "rope" }))).toBe(true);
  });
});
