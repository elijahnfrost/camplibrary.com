import { describe, expect, it } from "vitest";
import {
  hasRainAlternate,
  normalizeActivityAlternates,
  planPromote,
  resolveAlternates,
} from "./alternates";
import { ALTERNATES_MAX } from "./calendar/types";
import type { CalendarEvent } from "./calendar/types";
import type { Activity } from "./types";

const activity = (over: Partial<Activity> = {}): Activity =>
  ({
    id: "a1",
    title: "Capture the Flag",
    type: "Game",
    place: "Outside",
    ageMin: 9,
    ageMax: 12,
    durationMin: 30,
    groupMin: null,
    groupMax: null,
    energy: 3,
    prep: "Low",
    blurb: "",
    materials: [],
    steps: [],
    notes: "",
    safety: "",
    ages: ["g46"],
    rating: 0,
    ...over,
  }) as Activity;

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "e1",
  date: "2026-07-06",
  startMin: 600,
  endMin: 630,
  kind: "activity",
  title: "Capture the Flag",
  activityId: "a1",
  updatedAt: 1,
  ...over,
});

describe("normalizeActivityAlternates", () => {
  it("trims titles, whitelists reasons (default rain), keeps activityId + locations", () => {
    expect(
      normalizeActivityAlternates([
        { title: " Four Corners ", activityId: "a2", reason: "overflow", locations: [" Gym ", "gym"] },
        { title: "Quiet bingo" },
        { title: "Weird", reason: "bogus" },
      ])
    ).toEqual([
      { title: "Four Corners", activityId: "a2", reason: "overflow", locations: ["Gym"] },
      { title: "Quiet bingo", reason: "rain" },
      { title: "Weird", reason: "rain" },
    ]);
  });

  it("drops title-less / malformed rows and non-arrays", () => {
    expect(normalizeActivityAlternates([{ reason: "rain" }, "nope", null, 3])).toEqual([]);
    expect(normalizeActivityAlternates("nope")).toEqual([]);
    expect(normalizeActivityAlternates(undefined)).toEqual([]);
  });

  it("caps at ALTERNATES_MAX", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: "Alt " + i }));
    expect(normalizeActivityAlternates(many)).toHaveLength(ALTERNATES_MAX);
  });

  it("is deterministic (same input → same output)", () => {
    const input = [{ title: "A" }, { title: "B", reason: "choice" }];
    expect(normalizeActivityAlternates(input)).toEqual(normalizeActivityAlternates(input));
  });
});

describe("resolveAlternates — empty-array-authoritative rule", () => {
  const alts = [{ title: "Four Corners", reason: "rain" as const }];

  it("inherits the activity default when the event list is absent", () => {
    expect(resolveAlternates(event(), activity({ alternates: alts }))).toEqual(alts);
  });

  it("an EMPTY event list is authoritative 'no backups here' (does NOT inherit)", () => {
    expect(resolveAlternates(event({ alternates: [] }), activity({ alternates: alts }))).toEqual([]);
  });

  it("a present event list overrides the activity default", () => {
    const own = [{ title: "Board games", reason: "rain" as const }];
    expect(resolveAlternates(event({ alternates: own }), activity({ alternates: alts }))).toEqual(own);
  });

  it("resolves to [] for a custom event with no activity and no list", () => {
    expect(resolveAlternates(event({ activityId: undefined, kind: "custom" }), null)).toEqual([]);
  });
});

describe("hasRainAlternate", () => {
  it("is true only when a rain-reason backup is present", () => {
    expect(hasRainAlternate([{ title: "x", reason: "overflow" }])).toBe(false);
    expect(hasRainAlternate([{ title: "x", reason: "rain" }])).toBe(true);
    expect(hasRainAlternate([])).toBe(false);
  });
});

describe("planPromote", () => {
  it("swaps primary ⇄ backup, applies the backup's locations, parks the primary", () => {
    const e = event({ locations: ["Fields"] });
    const resolved = [{ title: "Four Corners", activityId: "a2", reason: "rain" as const, locations: ["Gym"] }];
    const out = planPromote(e, 0, resolved);
    expect(out.title).toBe("Four Corners");
    expect(out.activityId).toBe("a2");
    expect(out.kind).toBe("activity");
    expect(out.locations).toEqual(["Gym"]);
    // The displaced primary is parked as the backup at slot 0, carrying its places.
    expect(out.alternates).toEqual([
      { title: "Capture the Flag", activityId: "a1", reason: "rain", locations: ["Fields"] },
    ]);
  });

  it("a title-only backup makes a custom placement (kind + activityId cleared)", () => {
    const out = planPromote(event(), 0, [{ title: "Free choice", reason: "choice" }]);
    expect(out.kind).toBe("custom");
    expect("activityId" in out).toBe(false);
    expect(out.title).toBe("Free choice");
  });

  it("keeps the event's places when the backup names none", () => {
    const out = planPromote(event({ locations: ["Fields"] }), 0, [{ title: "Board games", reason: "rain" }]);
    expect(out.locations).toEqual(["Fields"]);
  });

  it("touches nothing but title/activityId/kind/locations/alternates/mealKind", () => {
    const e = event({ pinned: true, mealKind: "lunch", materialSubs: { p: "x" }, note: "hi" });
    const out = planPromote(e, 0, [{ title: "Alt", reason: "rain" }]);
    expect(out.startMin).toBe(e.startMin);
    expect(out.endMin).toBe(e.endMin);
    expect(out.pinned).toBe(true);
    expect(out.materialSubs).toEqual({ p: "x" });
    expect(out.note).toBe("hi");
  });

  it("clears mealKind on promote — the swapped-in content isn't a meal (meals-8)", () => {
    const e = event({ mealKind: "lunch" });
    const out = planPromote(e, 0, [{ title: "Indoor games", reason: "rain" }]);
    expect(out.mealKind).toBeUndefined();
  });

  it("is self-inverse: promote twice ≡ original (identity fields)", () => {
    const e = event({ locations: ["Fields"], alternates: [{ title: "Four Corners", activityId: "a2", reason: "rain", locations: ["Gym"] }] });
    const resolved = resolveAlternates(e, null);
    const once = planPromote(e, 0, resolved);
    const twice = planPromote(once, 0, resolveAlternates(once, null));
    expect(twice.title).toBe(e.title);
    expect(twice.activityId).toBe(e.activityId);
    expect(twice.kind).toBe(e.kind);
    expect(twice.locations).toEqual(e.locations);
    expect(twice.alternates).toEqual(e.alternates);
  });

  it("returns the event unchanged for an out-of-range index", () => {
    const e = event();
    expect(planPromote(e, 5, [])).toBe(e);
  });
});
