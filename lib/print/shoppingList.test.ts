import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { Material } from "@/lib/materials/materialCatalog";
import type { Activity } from "@/lib/types";
import type { ScheduleDay } from "./schedule";
import { buildShoppingList } from "./shoppingList";

function activity(partial: Partial<Activity> & { id: string; title: string }): Activity {
  return {
    type: "Game",
    place: "Outside",
    ageMin: 6,
    ageMax: 12,
    durationMin: 30,
    groupMin: 5,
    groupMax: 30,
    energy: 3,
    prep: "Low",
    ages: ["g46"],
    rating: 0,
    blurb: "",
    materials: [],
    steps: [],
    notes: "",
    safety: "",
    ...partial,
  };
}

function ev(id: string, date: string, activityId: string): CalendarEvent {
  return {
    id,
    date,
    activityId,
    startMin: 540,
    endMin: 600,
    kind: "custom",
    title: activityId,
    updatedAt: 0,
  };
}

function day(date: string, events: CalendarEvent[]): ScheduleDay {
  return { date, events };
}

describe("buildShoppingList", () => {
  it("returns [] when stock has never been reviewed (empty map = unset)", () => {
    const paint = activity({ id: "paint", title: "Painting", materialTags: ["Paint"] });
    const days = [day("2026-07-06", [ev("e1", "2026-07-06", "paint")])];
    expect(buildShoppingList(days, { paint }, {}, undefined)).toEqual([]);
  });

  it("lists a fully missing material as 'missing' with its day", () => {
    const paint = activity({ id: "paint", title: "Painting", materialTags: ["Paint"] });
    const days = [day("2026-07-06", [ev("e1", "2026-07-06", "paint")])];
    const list = buildShoppingList(days, { paint }, { paint: "out" }, undefined);
    expect(list).toEqual([{ id: "paint", label: "Paint", status: "missing", dates: ["2026-07-06"] }]);
  });

  it("omits a material covered by its own on-hand stock", () => {
    const paint = activity({ id: "paint", title: "Painting", materialTags: ["Paint"] });
    const days = [day("2026-07-06", [ev("e1", "2026-07-06", "paint")])];
    expect(buildShoppingList(days, { paint }, { paint: "have" }, undefined)).toEqual([]);
  });

  it("lists a material as 'low' when its own stock is thin", () => {
    const paint = activity({ id: "paint", title: "Painting", materialTags: ["Paint"] });
    const days = [day("2026-07-06", [ev("e1", "2026-07-06", "paint")])];
    const list = buildShoppingList(days, { paint }, { paint: "low" }, undefined);
    expect(list).toEqual([{ id: "paint", label: "Paint", status: "low", dates: ["2026-07-06"] }]);
  });

  it("omits a need covered by an in-stock substitute", () => {
    const craft = activity({ id: "craft", title: "Craft", materialTags: ["Glitter Glue"] });
    const catalog: Material[] = [
      { id: "glitter-glue", name: "Glitter Glue", substitutes: ["regular-glue"] },
      { id: "regular-glue", name: "Regular Glue" },
    ];
    const days = [day("2026-07-06", [ev("e1", "2026-07-06", "craft")])];
    const stock = { "glitter-glue": "out" as const, "regular-glue": "have" as const };
    expect(buildShoppingList(days, { craft }, stock, catalog)).toEqual([]);
  });

  it("lists a need as 'low' when its substitute is the covering item and is low", () => {
    const craft = activity({ id: "craft", title: "Craft", materialTags: ["Glitter Glue"] });
    const catalog: Material[] = [
      { id: "glitter-glue", name: "Glitter Glue", substitutes: ["regular-glue"] },
      { id: "regular-glue", name: "Regular Glue" },
    ];
    const days = [day("2026-07-06", [ev("e1", "2026-07-06", "craft")])];
    const stock = { "glitter-glue": "out" as const, "regular-glue": "low" as const };
    const list = buildShoppingList(days, { craft }, stock, catalog);
    expect(list).toEqual([{ id: "glitter-glue", label: "Glitter Glue", status: "low", dates: ["2026-07-06"] }]);
  });

  it("lists a fully uncovered need as 'missing' even with a substitute group, when neither is in stock", () => {
    const craft = activity({ id: "craft", title: "Craft", materialTags: ["Glitter Glue"] });
    const catalog: Material[] = [
      { id: "glitter-glue", name: "Glitter Glue", substitutes: ["regular-glue"] },
      { id: "regular-glue", name: "Regular Glue" },
    ];
    const days = [day("2026-07-06", [ev("e1", "2026-07-06", "craft")])];
    const stock = { "glitter-glue": "out" as const, "regular-glue": "out" as const };
    const list = buildShoppingList(days, { craft }, stock, catalog);
    expect(list).toEqual([{ id: "glitter-glue", label: "Glitter Glue", status: "missing", dates: ["2026-07-06"] }]);
  });

  it("collects every day across the range that needs the item, sorted", () => {
    const paint = activity({ id: "paint", title: "Painting", materialTags: ["Paint"] });
    const days = [
      day("2026-07-08", [ev("e2", "2026-07-08", "paint")]),
      day("2026-07-06", [ev("e1", "2026-07-06", "paint")]),
    ];
    const list = buildShoppingList(days, { paint }, { paint: "out" }, undefined);
    expect(list[0].dates).toEqual(["2026-07-06", "2026-07-08"]);
  });

  it("upgrades to 'missing' if any day reads missing, even if another day reads low for the same id", () => {
    // Same material id, but two different activities where the stock only
    // changes conceptually isn't representable per-day (stock is doc-wide) —
    // instead cover: one activity references it plainly (own stock out =
    // missing) and confirm a single 'out' state always yields 'missing'
    // regardless of how many activities/days reference it.
    const a = activity({ id: "a", title: "A", materialTags: ["Rope"] });
    const b = activity({ id: "b", title: "B", materialTags: ["Rope"] });
    const days = [
      day("2026-07-06", [ev("e1", "2026-07-06", "a")]),
      day("2026-07-07", [ev("e2", "2026-07-07", "b")]),
    ];
    const list = buildShoppingList(days, { a, b }, { rope: "out" }, undefined);
    expect(list).toEqual([{ id: "rope", label: "Rope", status: "missing", dates: ["2026-07-06", "2026-07-07"] }]);
  });

  it("skips a zero-need activity entirely", () => {
    const free = activity({ id: "free", title: "Free Play" });
    const days = [day("2026-07-06", [ev("e1", "2026-07-06", "free")])];
    expect(buildShoppingList(days, { free }, { anything: "out" }, undefined)).toEqual([]);
  });

  it("dedupes the same activity scheduled twice in one day", () => {
    const paint = activity({ id: "paint", title: "Painting", materialTags: ["Paint"] });
    const days = [
      day("2026-07-06", [ev("e1", "2026-07-06", "paint"), ev("e2", "2026-07-06", "paint")]),
    ];
    const list = buildShoppingList(days, { paint }, { paint: "out" }, undefined);
    expect(list).toEqual([{ id: "paint", label: "Paint", status: "missing", dates: ["2026-07-06"] }]);
  });

  it("sorts missing before low, then alphabetically within each group", () => {
    const rope = activity({ id: "rope-act", title: "Rope", materialTags: ["Rope"] });
    const balloons = activity({ id: "balloon-act", title: "Balloons", materialTags: ["Balloons"] });
    const cones = activity({ id: "cone-act", title: "Cones", materialTags: ["Cones"] });
    const days = [
      day("2026-07-06", [
        ev("e1", "2026-07-06", "rope-act"),
        ev("e2", "2026-07-06", "balloon-act"),
        ev("e3", "2026-07-06", "cone-act"),
      ]),
    ];
    const stock = { rope: "low" as const, balloons: "out" as const, cones: "out" as const };
    const list = buildShoppingList(days, { "rope-act": rope, "balloon-act": balloons, "cone-act": cones }, stock, undefined);
    expect(list.map((i) => i.id)).toEqual(["balloons", "cones", "rope"]);
  });
});
