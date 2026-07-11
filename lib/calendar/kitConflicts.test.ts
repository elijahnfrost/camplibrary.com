import { describe, expect, it } from "vitest";
import type { Activity } from "../types";
import type { Material } from "../materials/materialCatalog";
import type { StockState } from "../materials/kitStock";
import type { CalendarEvent } from "./types";
import { conflictsForEvent, dayKit } from "./kitConflicts";

// A minimal activity carrying a free-text material list — resolveRefs' third tier
// slugs each string to a materialTagId, so "Parachute" → id "parachute". That's
// the same join key the stock map + catalog use.
function activity(id: string, materials: string[]): Activity {
  return {
    id,
    title: id,
    type: "Game",
    place: "Outside",
    ageMin: 6,
    ageMax: 12,
    durationMin: 30,
    groupMin: null,
    groupMax: null,
    energy: 3,
    prep: "Low",
    blurb: "",
    materials,
    steps: [],
    notes: "",
    safety: "",
    ages: ["g13"],
    rating: 0,
  };
}

let seq = 0;
function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  seq += 1;
  return {
    id: "ev-" + seq,
    date: "2026-06-11",
    startMin: 600,
    endMin: 660,
    kind: "activity",
    title: "Block",
    activityId: undefined,
    updatedAt: 0,
    ...overrides,
  };
}

function byIdOf(...activities: Activity[]): Record<string, Activity> {
  const map: Record<string, Activity> = {};
  for (const a of activities) map[a.id] = a;
  return map;
}

// A stock map with at least one key is "set" (the lens is live); {} is UNSET.
const LIVE: Record<string, StockState> = { anything: "have" };

describe("dayKit — gather list (items)", () => {
  it("unions distinct needs across activity-backed timed blocks", () => {
    const para = activity("parachute-games", ["Parachute", "Cones"]);
    const relay = activity("water-relay", ["Cones", "Buckets"]);
    const events = [
      event({ id: "a", activityId: para.id, startMin: 600, endMin: 660 }),
      event({ id: "b", activityId: relay.id, startMin: 660, endMin: 720 }),
    ];
    const { items } = dayKit(events, byIdOf(para, relay), {});
    expect(items.map((i) => i.id)).toEqual(["buckets", "cones", "parachute"]);
    // Cones is needed by both; parachute + buckets by one each.
    const cones = items.find((i) => i.id === "cones");
    expect(cones?.eventIds.sort()).toEqual(["a", "b"]);
    expect(items.find((i) => i.id === "parachute")?.eventIds).toEqual(["a"]);
  });

  it("excludes reminders, all-day, and activity-less events from the gather list", () => {
    const para = activity("parachute-games", ["Parachute"]);
    const events = [
      event({ id: "rem", activityId: para.id, startMin: 600, endMin: 600 }), // 0-min reminder
      event({ id: "allday", activityId: para.id, allDay: true, startMin: 0, endMin: 0 }),
      event({ id: "custom", activityId: undefined, title: "Free play" }), // no activity
    ];
    const { items, hardConflicts, softWarnings } = dayKit(events, byIdOf(para), {});
    expect(items).toEqual([]);
    expect(hardConflicts).toEqual([]);
    expect(softWarnings).toEqual([]);
  });

  it("reads coverage status from stock + substitutes like the run sheet", () => {
    const a = activity("a", ["Parachute", "Big ball", "Rope", "Ghost"]);
    const stock: Record<string, StockState> = {
      parachute: "have",
      "big-ball": "low",
      "beach-ball": "have", // stands in for rope? no — set up below
      rope: "out",
    };
    const catalog: Material[] = [
      { id: "rope", name: "Rope", substitutes: ["twine"] },
      { id: "twine", name: "Twine" },
    ];
    stock.twine = "have"; // rope is out but twine (a substitute) is on hand
    const events = [event({ id: "x", activityId: a.id, startMin: 600, endMin: 660 })];
    const { items } = dayKit(events, byIdOf(a), stock, catalog);
    const status = Object.fromEntries(items.map((i) => [i.id, i.status]));
    expect(status.parachute).toBe("have");
    expect(status["big-ball"]).toBe("low");
    expect(status.rope).toBe("substituted");
    expect(items.find((i) => i.id === "rope")?.viaId).toBe("twine");
    expect(status.ghost).toBe("missing"); // never reviewed, no substitute
  });

  it("keeps the whole list inert (all 'have') when stock is UNSET ({})", () => {
    const a = activity("a", ["Parachute", "Rope"]);
    const events = [event({ id: "x", activityId: a.id })];
    const { items } = dayKit(events, byIdOf(a), {});
    expect(items.every((i) => i.status === "have")).toBe(true);
  });

  it("marks an explicitly out-of-stock item 'out', not 'missing'", () => {
    const a = activity("a", ["Parachute"]);
    const events = [event({ id: "x", activityId: a.id })];
    const { items } = dayKit(events, byIdOf(a), { parachute: "out" });
    expect(items[0].status).toBe("out");
  });
});

describe("dayKit — hard conflicts (overlap + exact-ref + plenty)", () => {
  const para = activity("parachute-games", ["Parachute"]);
  const relay = activity("water-relay", ["Parachute"]);
  const byId = byIdOf(para, relay);

  it("flags two overlapping blocks needing the same material", () => {
    const events = [
      event({ id: "a", activityId: para.id, startMin: 600, endMin: 660 }),
      event({ id: "b", activityId: relay.id, startMin: 630, endMin: 690 }),
    ];
    const { hardConflicts } = dayKit(events, byId, LIVE);
    expect(hardConflicts).toHaveLength(1);
    expect(hardConflicts[0].id).toBe("parachute");
    expect(hardConflicts[0].eventIds).toEqual(["a", "b"]);
  });

  it("does NOT flag blocks that merely touch (half-open [start,end))", () => {
    const events = [
      event({ id: "a", activityId: para.id, startMin: 600, endMin: 660 }),
      event({ id: "b", activityId: relay.id, startMin: 660, endMin: 720 }), // starts as a ends
    ];
    const { hardConflicts } = dayKit(events, byId, LIVE);
    expect(hardConflicts).toEqual([]);
  });

  it("does NOT flag same-material blocks that don't overlap in time", () => {
    const events = [
      event({ id: "a", activityId: para.id, startMin: 600, endMin: 660 }),
      event({ id: "b", activityId: relay.id, startMin: 700, endMin: 760 }),
    ];
    const { hardConflicts } = dayKit(events, byId, LIVE);
    expect(hardConflicts).toEqual([]);
  });

  it("suppresses the conflict when the material is catalog `plenty`", () => {
    const catalog: Material[] = [{ id: "parachute", name: "Parachute", plenty: true }];
    const events = [
      event({ id: "a", activityId: para.id, startMin: 600, endMin: 660 }),
      event({ id: "b", activityId: relay.id, startMin: 630, endMin: 690 }),
    ];
    const { hardConflicts } = dayKit(events, byId, LIVE, catalog);
    expect(hardConflicts).toEqual([]);
  });

  it("does NOT count a need satisfied only by a SUBSTITUTE toward a hard conflict", () => {
    // Both need rope; block b's rope is covered by twine — but the exact-ref rule
    // means both still call for `rope`, so the overlap IS a conflict. The rule is
    // "exact refs contend"; substitution never REMOVES a ref, it only recolors
    // status. So this asserts the exact-ref contention still fires (under-warning
    // via substitution is a status concern, not a contention one).
    const ropeA = activity("rope-a", ["Rope"]);
    const ropeB = activity("rope-b", ["Rope"]);
    const catalog: Material[] = [
      { id: "rope", name: "Rope", substitutes: ["twine"] },
      { id: "twine", name: "Twine" },
    ];
    const events = [
      event({ id: "a", activityId: ropeA.id, startMin: 600, endMin: 660 }),
      event({ id: "b", activityId: ropeB.id, startMin: 630, endMin: 690 }),
    ];
    const { hardConflicts } = dayKit(events, byIdOf(ropeA, ropeB), { rope: "have", twine: "have" }, catalog);
    expect(hardConflicts.map((c) => c.id)).toEqual(["rope"]);
  });

  it("catches three staggered pairwise-overlapping blocks in one conflict", () => {
    const c = activity("c", ["Parachute"]);
    const events = [
      event({ id: "a", activityId: para.id, startMin: 600, endMin: 700 }),
      event({ id: "b", activityId: relay.id, startMin: 650, endMin: 750 }),
      event({ id: "c", activityId: c.id, startMin: 680, endMin: 780 }),
    ];
    const { hardConflicts } = dayKit(events, byIdOf(para, relay, c), LIVE);
    expect(hardConflicts).toHaveLength(1);
    expect(hardConflicts[0].eventIds).toEqual(["a", "b", "c"]);
  });
});

describe("dayKit — soft warnings (consumable OR low, ≥2 blocks)", () => {
  const glue1 = activity("g1", ["Glue"]);
  const glue2 = activity("g2", ["Glue"]);
  const byId = byIdOf(glue1, glue2);

  it("warns when a consumable is needed by two+ blocks (times irrelevant)", () => {
    const catalog: Material[] = [{ id: "glue", name: "Glue", consumable: true }];
    const events = [
      event({ id: "a", activityId: glue1.id, startMin: 600, endMin: 660 }),
      event({ id: "b", activityId: glue2.id, startMin: 900, endMin: 960 }), // far apart
    ];
    const { softWarnings } = dayKit(events, byId, LIVE, catalog);
    expect(softWarnings.map((w) => w.id)).toEqual(["glue"]);
    expect(softWarnings[0].eventIds.sort()).toEqual(["a", "b"]);
  });

  it("warns when a shared material is currently stock 'low'", () => {
    const events = [
      event({ id: "a", activityId: glue1.id }),
      event({ id: "b", activityId: glue2.id }),
    ];
    const { softWarnings } = dayKit(events, byId, { glue: "low" });
    expect(softWarnings.map((w) => w.id)).toEqual(["glue"]);
  });

  it("does not warn for a single block, or a plentiful non-consumable", () => {
    const events = [event({ id: "a", activityId: glue1.id })];
    expect(dayKit(events, byId, { glue: "low" }).softWarnings).toEqual([]);
    const two = [
      event({ id: "a", activityId: glue1.id }),
      event({ id: "b", activityId: glue2.id }),
    ];
    // have + not consumable → no soft warning.
    expect(dayKit(two, byId, { glue: "have" }).softWarnings).toEqual([]);
  });

  it("a low material shared by overlapping blocks is BOTH a hard conflict and a soft warning", () => {
    const events = [
      event({ id: "a", activityId: glue1.id, startMin: 600, endMin: 660 }),
      event({ id: "b", activityId: glue2.id, startMin: 630, endMin: 690 }),
    ];
    const day = dayKit(events, byId, { glue: "low" });
    expect(day.hardConflicts.map((c) => c.id)).toEqual(["glue"]);
    expect(day.softWarnings.map((w) => w.id)).toEqual(["glue"]);
  });
});

describe("dayKit — determinism", () => {
  it("returns identical output regardless of input event order", () => {
    const p = activity("p", ["Parachute", "Cones"]);
    const q = activity("q", ["Cones", "Buckets"]);
    const byId = byIdOf(p, q);
    const evs = [
      event({ id: "a", activityId: p.id, startMin: 600, endMin: 660 }),
      event({ id: "b", activityId: q.id, startMin: 630, endMin: 690 }),
    ];
    const forward = dayKit(evs, byId, LIVE);
    const reversed = dayKit([...evs].reverse(), byId, LIVE);
    expect(reversed).toEqual(forward);
  });
});

describe("conflictsForEvent", () => {
  it("returns only the hard conflicts an event participates in", () => {
    const para = activity("parachute-games", ["Parachute"]);
    const relay = activity("water-relay", ["Parachute"]);
    const solo = activity("solo", ["Beanbags"]);
    const events = [
      event({ id: "a", activityId: para.id, startMin: 600, endMin: 660 }),
      event({ id: "b", activityId: relay.id, startMin: 630, endMin: 690 }),
      event({ id: "c", activityId: solo.id, startMin: 800, endMin: 860 }),
    ];
    const day = dayKit(events, byIdOf(para, relay, solo), LIVE);
    expect(conflictsForEvent(day, "a").map((c) => c.id)).toEqual(["parachute"]);
    expect(conflictsForEvent(day, "c")).toEqual([]);
  });
});
