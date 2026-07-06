import { describe, expect, it } from "vitest";
import {
  isLibrarySort,
  matchesActivityFilters,
  matchesActivitySearch,
  normalizeSearchText,
  searchTokens,
  sortActivities,
  type ActivityFilterState,
} from "./activityFilters";
import { ALL_CATEGORY_IDS } from "./data";
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
  cats: ALL_CATEGORY_IDS,
  place: "All",
  age: "All",
  query: "",
  kitLens: "all",
};

function filters(overrides: Partial<ActivityFilterState> = {}): ActivityFilterState {
  return { ...allFilters, ...overrides };
}

describe("activity filters", () => {
  it("filters by category (multi-select)", () => {
    expect(matchesActivityFilters(activity({ type: "Game" }), filters({ cats: ["Game"] }))).toBe(true);
    expect(matchesActivityFilters(activity({ type: "Craft" }), filters({ cats: ["Game"] }))).toBe(false);
    // A subset shows every listed category…
    expect(matchesActivityFilters(activity({ type: "Craft" }), filters({ cats: ["Game", "Craft"] }))).toBe(true);
    // …and an empty set shows nothing.
    expect(matchesActivityFilters(activity({ type: "Game" }), filters({ cats: [] }))).toBe(false);
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

  it("applies the kit lens (all / ready / almost) against coverage", () => {
    const base = activity({ type: "Game", materials: ["Cones", "Rope"] });

    // "all" (or absent) never narrows.
    expect(matchesActivityFilters(base, filters({ kitLens: undefined }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ kitLens: "all" }))).toBe(true);

    // Ready: only fully-covered activities pass.
    expect(matchesActivityFilters(base, filters({ kitLens: "ready", kitStock: { cones: "have", rope: "have" } }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ kitLens: "ready", kitStock: { cones: "have", rope: "out" } }))).toBe(false);

    // +Almost also keeps the one-item-short ones, but not the can't (>= 2 short).
    expect(matchesActivityFilters(base, filters({ kitLens: "almost", kitStock: { cones: "have", rope: "out" } }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ kitLens: "almost", kitStock: { cones: "out", rope: "out" } }))).toBe(false);

    // The lens still ANDs with the other dimensions.
    expect(
      matchesActivityFilters(base, filters({ cats: ["Craft"], kitLens: "ready", kitStock: { cones: "have", rope: "have" } }))
    ).toBe(false);
  });

  it("the kit lens is INERT while stock is unset (passes everything)", () => {
    const base = activity({ type: "Game", materials: ["Cones", "Rope"] });
    // Empty stock map = UNSET → a fresh library is never blanked, whatever the lens.
    expect(matchesActivityFilters(base, filters({ kitLens: "ready", kitStock: {} }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ kitLens: "almost", kitStock: {} }))).toBe(true);
    // Absent stock behaves the same as an empty map.
    expect(matchesActivityFilters(base, filters({ kitLens: "ready" }))).toBe(true);
  });

  it("filters by a single material id (the Materials-tab browse jump)", () => {
    // resolveRefs derives ids from the free-text materials (materialTagId slugs),
    // so the clause reuses the same three-tier machinery the picker/checklist do.
    const balloons = activity({ id: "a-balloon", materials: ["Balloons", "String"] });
    const cones = activity({ id: "a-cones", materials: ["Cones"] });

    expect(matchesActivityFilters(balloons, filters({ materialId: "balloons" }))).toBe(true);
    expect(matchesActivityFilters(cones, filters({ materialId: "balloons" }))).toBe(false);
    // An id no activity uses matches nothing.
    expect(matchesActivityFilters(balloons, filters({ materialId: "glitter" }))).toBe(false);
    // Absent/empty never narrows.
    expect(matchesActivityFilters(cones, filters({ materialId: undefined }))).toBe(true);
    expect(matchesActivityFilters(cones, filters({ materialId: "" }))).toBe(true);
    // It ANDs with the other dimensions.
    expect(
      matchesActivityFilters(balloons, filters({ cats: ["Craft"], materialId: "balloons" }))
    ).toBe(false);
  });

  it("filters by an inclusive duration window (endpoints included)", () => {
    const short = activity({ id: "a-short", durationMin: 15 });
    const mid = activity({ id: "a-mid", durationMin: 30 });
    const long = activity({ id: "a-long", durationMin: 60 });

    // Omitting `minutes` matches any length.
    expect(matchesActivityFilters(long, filters())).toBe(true);

    // A [20, 45] window keeps only the mid activity; both endpoints are inclusive.
    expect(matchesActivityFilters(short, filters({ minutes: [20, 45] }))).toBe(false);
    expect(matchesActivityFilters(mid, filters({ minutes: [20, 45] }))).toBe(true);
    expect(matchesActivityFilters(long, filters({ minutes: [20, 45] }))).toBe(false);
    expect(matchesActivityFilters(short, filters({ minutes: [15, 30] }))).toBe(true);
    expect(matchesActivityFilters(mid, filters({ minutes: [15, 30] }))).toBe(true);

    // The window still ANDs with the other dimensions.
    expect(
      matchesActivityFilters(activity({ type: "Craft", durationMin: 30 }), filters({ cats: ["Game"], minutes: [15, 45] }))
    ).toBe(false);
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

  it("matches every word of a multi-word query in any order (not just the literal phrase)", () => {
    const base = activity({
      title: "Relay race",
      blurb: "Pass balloons down the line",
      materials: ["Balloons"],
    });

    // The words are scattered across title + blurb and out of order — the old
    // whole-phrase match would have failed all three of these.
    expect(matchesActivityFilters(base, filters({ query: "balloon relay" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "relay balloons" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "relay line balloons" }))).toBe(true);
    // A word that isn't present anywhere still rules the activity out.
    expect(matchesActivityFilters(base, filters({ query: "relay frisbee" }))).toBe(false);
  });

  it("searches accent- and case-insensitively", () => {
    const base = activity({
      title: "Mask making",
      materials: ["Papier-mâché paste", "Balloons"],
    });

    // The material carries an accent; the user almost never types it.
    expect(matchesActivityFilters(base, filters({ query: "mache" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "papier mache" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "PAPIER MÂCHÉ" }))).toBe(true);
  });

  it("finds hyphenated text when the query uses spaces", () => {
    const base = activity({ title: "Tug-of-war", altNames: ["Rope pull"] });

    expect(matchesActivityFilters(base, filters({ query: "tug of war" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "war tug" }))).toBe(true);
  });

  it("searches variation text", () => {
    const base = activity({
      title: "Capture the flag",
      variations: ["Rainy-day indoor version using the gym"],
    });

    expect(matchesActivityFilters(base, filters({ query: "rainy gym" }))).toBe(true);
  });

  it("finds an apostrophe title when the query's quote is a different (curly) character", () => {
    // The catalog is written with a plain apostrophe; iOS/macOS text inputs
    // routinely substitute a curly one ("smart quotes") as the user types.
    const base = activity({ title: "Kim's Game", altNames: ["What's Missing"] });

    expect(matchesActivityFilters(base, filters({ query: "Kim’s Game" }))).toBe(true);
    expect(matchesActivityFilters(base, filters({ query: "What’s Missing" }))).toBe(true);
    // And the reverse: catalog text with a curly quote still matches a plain one.
    const curlyTitled = activity({ title: "Kim’s Game" });
    expect(matchesActivityFilters(curlyTitled, filters({ query: "Kim's Game" }))).toBe(true);
  });
});

describe("search helpers", () => {
  it("normalizeSearchText folds case and strips accents", () => {
    expect(normalizeSearchText("Café")).toBe("cafe");
    expect(normalizeSearchText("PAPIER-MÂCHÉ")).toBe("papier-mache");
  });

  it("searchTokens splits on whitespace and drops empties", () => {
    expect(searchTokens("  balloon   relay ")).toEqual(["balloon", "relay"]);
    expect(searchTokens("   ")).toEqual([]);
    expect(searchTokens("")).toEqual([]);
  });

  it("matchesActivitySearch matches everything for an empty query", () => {
    const base = activity({ title: "Anything" });
    expect(matchesActivitySearch(base, "")).toBe(true);
    expect(matchesActivitySearch(base, "   ")).toBe(true);
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
