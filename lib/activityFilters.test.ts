import { describe, expect, it } from "vitest";
import {
  isLibrarySort,
  matchesActivityFilters,
  sortActivities,
  type ActivityFilterState,
} from "./activityFilters";
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

  it("filters by theme using the assignment map", () => {
    const ocean = activity({ id: "a-ocean" });
    const jungle = activity({ id: "a-jungle" });
    const untagged = activity({ id: "a-plain" });
    const themeAssignments = { "a-ocean": "theme-ocean", "a-jungle": "theme-jungle" };

    // "All" ignores theme entirely.
    expect(matchesActivityFilters(untagged, filters({ theme: "All", themeAssignments }))).toBe(true);

    expect(matchesActivityFilters(ocean, filters({ theme: "theme-ocean", themeAssignments }))).toBe(true);
    expect(matchesActivityFilters(jungle, filters({ theme: "theme-ocean", themeAssignments }))).toBe(false);
    // An untagged activity never matches a specific theme.
    expect(matchesActivityFilters(untagged, filters({ theme: "theme-ocean", themeAssignments }))).toBe(false);
  });

  it("composes the kit filter (uses ANY picked item) with other filters", () => {
    const base = activity({ type: "Game", materials: ["Cones", "Rope"] });

    expect(matchesActivityFilters(base, filters({ availableMaterialTags: undefined }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ availableMaterialTags: [] }))).toBe(true);
    // A single overlapping kit item surfaces the activity (matches its count badge).
    expect(matchesActivityFilters(base, filters({ availableMaterialTags: ["cones"] }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ availableMaterialTags: ["string"] }))).toBe(false);
    expect(matchesActivityFilters(base, filters({ availableMaterialTags: ["string", "rope"] }))).toBe(true);
    // The kit filter still ANDs with the other dimensions.
    expect(matchesActivityFilters(base, filters({ cat: "Craft", availableMaterialTags: ["cones"] }))).toBe(false);
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

  it("searches alternate names so a local/aka name finds the game", () => {
    const base = activity({
      title: "Sharks & Minnows",
      altNames: ["Octopus", "Fishes and Sharks"],
    });

    // The alias appears nowhere in the title/blurb/steps, only in altNames.
    expect(matchesActivityFilters(base, filters({ query: "octopus" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "fishes and sharks" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "sharks" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "kickball" }))).toBe(false);
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

describe("sortActivities", () => {
  const titles = (list: Activity[]) => list.map((a) => a.title);

  it("sorts A–Z by title, case-insensitively", () => {
    const list = [
      activity({ id: "c", title: "canoe" }),
      activity({ id: "a", title: "Archery" }),
      activity({ id: "b", title: "balloon" }),
    ];
    expect(titles(sortActivities(list, "az"))).toEqual(["Archery", "balloon", "canoe"]);
  });

  it("sorts by rating high→low", () => {
    const list = [
      activity({ id: "lo", title: "Low", rating: 2 }),
      activity({ id: "hi", title: "High", rating: 5 }),
      activity({ id: "mid", title: "Mid", rating: 3 }),
    ];
    expect(titles(sortActivities(list, "rating"))).toEqual(["High", "Mid", "Low"]);
  });

  it("sinks unrated (0) activities to the bottom", () => {
    const list = [
      activity({ id: "u1", title: "Unrated A", rating: 0 }),
      activity({ id: "r", title: "Rated", rating: 1 }),
      activity({ id: "u2", title: "Unrated B", rating: 0 }),
    ];
    // Rated first; both unrated trail, ordered A–Z among themselves.
    expect(titles(sortActivities(list, "rating"))).toEqual(["Rated", "Unrated A", "Unrated B"]);
  });

  it("breaks rating ties with A–Z", () => {
    const list = [
      activity({ id: "z", title: "Zebra", rating: 4 }),
      activity({ id: "a", title: "Apple", rating: 4 }),
    ];
    expect(titles(sortActivities(list, "rating"))).toEqual(["Apple", "Zebra"]);
  });

  it("does not mutate the input array", () => {
    const list = [activity({ id: "b", title: "B" }), activity({ id: "a", title: "A" })];
    const snapshot = titles(list);
    sortActivities(list, "az");
    expect(titles(list)).toEqual(snapshot);
  });

  it("validates the sort key", () => {
    expect(isLibrarySort("az")).toBe(true);
    expect(isLibrarySort("rating")).toBe(true);
    expect(isLibrarySort("nope")).toBe(false);
    expect(isLibrarySort(undefined)).toBe(false);
  });
});
