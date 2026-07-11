import { describe, expect, it } from "vitest";
import type { Activity } from "../types";
import { CUSTOM_NEUTRAL, LOCATION_TINTS, categoryTint, ratingColor } from "../content/data";
import type { Theme } from "../content/themes";
import { fromFcDates, healEvent, splitDayLegLabels, toFcEvent } from "./adapter";
import type { CalendarEvent } from "./types";

const ACTIVITY: Activity = {
  id: "capture-flag",
  title: "Capture the Flag",
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
  materials: [],
  steps: [],
  notes: "",
  safety: "",
  ages: ["g13"],
  rating: 0,
};

const BY_ID = { [ACTIVITY.id]: ACTIVITY };

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    date: "2026-06-11",
    startMin: 540,
    endMin: 600,
    kind: "activity",
    title: "Capture the Flag",
    activityId: "capture-flag",
    updatedAt: 0,
    ...overrides,
  };
}

describe("toFcEvent", () => {
  it("converts DateKey + minutes into local Dates", () => {
    const fc = toFcEvent(event(), BY_ID);
    const start = fc.start as Date;
    const end = fc.end as Date;
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(5);
    expect(start.getDate()).toBe(11);
    expect(start.getHours()).toBe(9);
    expect(end.getHours()).toBe(10);
    expect(fc.allDay).toBe(false);
    expect(fc.title).toBe("Capture the Flag");
  });

  it("prefers the live activity title over the denormalized one", () => {
    const fc = toFcEvent(event({ title: "Old stale title" }), BY_ID);
    expect(fc.title).toBe("Capture the Flag");
  });

  it("handles all-day events", () => {
    const fc = toFcEvent(event({ allDay: true, startMin: 0, endMin: 0 }), BY_ID);
    expect(fc.allDay).toBe(true);
    expect(fc.end).toBeUndefined();
  });

  it("threads the pinned flag into extendedProps for the card glyph", () => {
    // Absent → false (so a plain card never draws the pin), present → true.
    expect(toFcEvent(event(), BY_ID).extendedProps?.pinned).toBe(false);
    expect(toFcEvent(event({ pinned: true }), BY_ID).extendedProps?.pinned).toBe(true);
  });

  it("threads a `customized` tick from a series member's custom list", () => {
    // No custom fields → false (plain card, no tick); a non-empty list → true.
    expect(toFcEvent(event(), BY_ID).extendedProps?.customized).toBe(false);
    expect(toFcEvent(event({ custom: ["startMin"] }), BY_ID).extendedProps?.customized).toBe(true);
    // An empty list is not "customized".
    expect(toFcEvent(event({ custom: [] }), BY_ID).extendedProps?.customized).toBe(false);
  });

  it("threads a split-day leg label when one is supplied", () => {
    expect(toFcEvent(event(), BY_ID).extendedProps?.legLabel).toBeUndefined();
    expect(
      toFcEvent(event(), BY_ID, undefined, "custom", undefined, "1/2").extendedProps?.legLabel
    ).toBe("1/2");
  });

  it("threads a backup-plan glyph only when it carries a count", () => {
    expect(toFcEvent(event(), BY_ID).extendedProps?.alternatesGlyph).toBeUndefined();
    expect(
      toFcEvent(event(), BY_ID, undefined, "custom", undefined, undefined, { rain: false, count: 0 })
        .extendedProps?.alternatesGlyph
    ).toBeUndefined();
    expect(
      toFcEvent(event(), BY_ID, undefined, "custom", undefined, undefined, { rain: true, count: 2 })
        .extendedProps?.alternatesGlyph
    ).toEqual({ rain: true, count: 2 });
  });

});

describe("splitDayLegLabels", () => {
  it("labels the ordered legs of a same-day linked pair", () => {
    const a = event({ id: "a", linkId: "L", startMin: 540 });
    const b = event({ id: "b", linkId: "L", startMin: 840 });
    const labels = splitDayLegLabels([b, a]); // out of order in
    expect(labels).toEqual({ a: "1/2", b: "2/2" });
  });

  it("orders three legs by start time", () => {
    const a = event({ id: "a", linkId: "L", startMin: 900 });
    const b = event({ id: "b", linkId: "L", startMin: 540 });
    const c = event({ id: "c", linkId: "L", startMin: 720 });
    expect(splitDayLegLabels([a, b, c])).toEqual({ b: "1/3", c: "2/3", a: "3/3" });
  });

  it("labels nothing for a lone linkId (sibling deleted) or unlinked events", () => {
    const lone = event({ id: "a", linkId: "L" });
    const plain = event({ id: "b" });
    expect(splitDayLegLabels([lone, plain])).toEqual({});
  });

  it("keeps two same-day linkIds and a cross-day link separate", () => {
    const a = event({ id: "a", linkId: "L", date: "2026-06-11", startMin: 540 });
    const b = event({ id: "b", linkId: "L", date: "2026-06-11", startMin: 840 });
    // Same linkId, DIFFERENT day → not a pair (each is a lone leg on its day).
    const c = event({ id: "c", linkId: "L", date: "2026-06-12", startMin: 540 });
    const labels = splitDayLegLabels([a, b, c]);
    expect(labels).toEqual({ a: "1/2", b: "2/2" });
  });
});

describe("fromFcDates round-trip", () => {
  it("preserves date and minutes through a drag", () => {
    const original = event();
    const fc = toFcEvent(original, BY_ID);
    const back = fromFcDates(fc.start as Date, fc.end as Date, false, original);
    expect(back.date).toBe(original.date);
    expect(back.startMin).toBe(original.startMin);
    expect(back.endMin).toBe(original.endMin);
  });

  it("moves an event to a new day and time", () => {
    const moved = fromFcDates(new Date(2026, 5, 12, 14, 15), new Date(2026, 5, 12, 15, 0), false, event());
    expect(moved.date).toBe("2026-06-12");
    expect(moved.startMin).toBe(14 * 60 + 15);
    expect(moved.endMin).toBe(15 * 60);
    expect(moved.updatedAt).toBeGreaterThan(0);
  });

  it("clamps a resize that crosses midnight to the same day", () => {
    const stretched = fromFcDates(new Date(2026, 5, 11, 23, 0), new Date(2026, 5, 12, 1, 0), false, event());
    expect(stretched.date).toBe("2026-06-11");
    expect(stretched.endMin).toBe(1440);
  });

  it("enforces a minimum duration", () => {
    const tiny = fromFcDates(new Date(2026, 5, 11, 9, 0), new Date(2026, 5, 11, 9, 0), false, event());
    expect(tiny.endMin - tiny.startMin).toBeGreaterThanOrEqual(5);
  });

  it("converts a timed event dropped on the all-day strip", () => {
    const allDay = fromFcDates(new Date(2026, 5, 11), null, true, event());
    expect(allDay.allDay).toBe(true);
    expect(allDay.startMin).toBe(0);
  });

  it("keeps a 0-min reminder 0-min through a round-trip", () => {
    const reminder = event({ startMin: 540, endMin: 540 });
    const fc = toFcEvent(reminder, BY_ID);
    const back = fromFcDates(fc.start as Date, fc.end as Date, false, reminder);
    expect(back.startMin).toBe(back.endMin); // still a point in time, not a block
    expect(back.startMin).toBe(540);
  });

  it("keeps a reminder 0-min when moved to a new day and time", () => {
    const reminder = event({ startMin: 540, endMin: 540 });
    const back = fromFcDates(new Date(2026, 5, 12, 10, 30), new Date(2026, 5, 12, 10, 31), false, reminder);
    expect(back.date).toBe("2026-06-12");
    expect(back.startMin).toBe(10 * 60 + 30);
    expect(back.endMin).toBe(10 * 60 + 30);
  });

  it("snaps to a coarser camp grid when a snap is threaded", () => {
    // A drop at 9:10 with a 30-min grid floors the START to 9:00 and the END to
    // the nearest 30 (10:10 → 10:00), so both land on the coarse grid.
    const moved = fromFcDates(
      new Date(2026, 5, 12, 9, 10),
      new Date(2026, 5, 12, 10, 10),
      false,
      event(),
      30
    );
    expect(moved.startMin % 30).toBe(0);
    expect(moved.endMin % 30).toBe(0);
    expect(moved.startMin).toBe(9 * 60);
  });

  it("snaps to a finer camp grid when a 5-min snap is threaded", () => {
    const moved = fromFcDates(
      new Date(2026, 5, 12, 9, 5),
      new Date(2026, 5, 12, 9, 20),
      false,
      event(),
      5
    );
    expect(moved.startMin).toBe(9 * 60 + 5);
    expect(moved.endMin).toBe(9 * 60 + 20);
  });

  it("keeps at least one snap slot of length on a coarse grid resize", () => {
    const tiny = fromFcDates(
      new Date(2026, 5, 11, 9, 0),
      new Date(2026, 5, 11, 9, 1),
      false,
      event(),
      30
    );
    expect(tiny.endMin - tiny.startMin).toBeGreaterThanOrEqual(30);
  });

  it("defaults to the 15-min grid when no snap is threaded (back-compat)", () => {
    const moved = fromFcDates(new Date(2026, 5, 12, 9, 8), new Date(2026, 5, 12, 10, 0), false, event());
    expect(moved.startMin).toBe(9 * 60 + 15);
  });
});

describe("healEvent", () => {
  it("keeps valid refs", () => {
    expect(healEvent(event(), BY_ID)).toEqual(event());
  });

  it("strips refs to deleted activities, keeping the event as custom", () => {
    const healed = healEvent(event({ activityId: "deleted-activity" }), BY_ID);
    expect(healed.activityId).toBeUndefined();
    expect(healed.kind).toBe("custom");
    expect(healed.title).toBe("Capture the Flag");
  });
});

// The "Color by" modes resolve a different --cal-tint without ever touching the
// event's stored color — the tint lands in extendedProps.tint for the painter.
describe("toFcEvent color modes", () => {
  const RATED: Activity = { ...ACTIVITY, id: "rated", rating: 5 };
  const BY_ID_RATED = { ...BY_ID, [RATED.id]: RATED };

  // A standalone custom event (no activity backing it).
  function customEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return event({ kind: "custom", activityId: undefined, title: "Lunch", ...overrides });
  }

  function tintOf(fc: ReturnType<typeof toFcEvent>): unknown {
    return fc.extendedProps?.tint;
  }

  it("custom mode keeps the per-event/activity → category tint (default)", () => {
    // Capture the Flag is an unstyled Game, so it falls to the Game category tint.
    expect(tintOf(toFcEvent(event(), BY_ID, undefined, "custom"))).toBe(categoryTint("Game"));
    // The default arg matches explicit "custom".
    expect(tintOf(toFcEvent(event(), BY_ID))).toBe(categoryTint("Game"));
  });

  it("type mode colors by category, custom events by the neutral category tint", () => {
    expect(tintOf(toFcEvent(event(), BY_ID, undefined, "type"))).toBe(categoryTint("Game"));
    // No activity → categoryTint(undefined), the neutral stone.
    expect(tintOf(toFcEvent(customEvent(), BY_ID, undefined, "type"))).toBe(categoryTint(undefined));
  });

  it("rating mode: custom-neutral for a custom event, kraft for unrated, scale for rated", () => {
    // A custom event has nothing to rate → the cooler custom stone.
    expect(tintOf(toFcEvent(customEvent(), BY_ID, undefined, "rating"))).toBe(CUSTOM_NEUTRAL);
    // An unrated activity (rating 0) → the warm kraft, a DIFFERENT gray.
    expect(tintOf(toFcEvent(event(), BY_ID, undefined, "rating"))).toBe(ratingColor(0));
    expect(ratingColor(0)).not.toBe(CUSTOM_NEUTRAL);
    // A rated activity → its place on the warm low→high scale.
    const fc = toFcEvent(event({ activityId: "rated" }), BY_ID_RATED, undefined, "rating");
    expect(tintOf(fc)).toBe(ratingColor(5));
  });

  it("location mode maps the first location, falling back to the neutral", () => {
    const inGym = toFcEvent(event({ locations: ["Gym", "Fields"] }), BY_ID, undefined, "location");
    expect(tintOf(inGym)).toBe(LOCATION_TINTS.Gym);
    // No location → the neutral stone.
    expect(tintOf(toFcEvent(event(), BY_ID, undefined, "location"))).toBe(CUSTOM_NEUTRAL);
    // A legacy free-text location not in the taxonomy → the neutral stone.
    expect(tintOf(toFcEvent(event({ locations: ["Back lawn"] }), BY_ID, undefined, "location"))).toBe(
      CUSTOM_NEUTRAL
    );
  });

  it("location mode honors a per-location color override (e.g. a yellow Gym)", () => {
    const colors = { Gym: "#e0b15a" };
    // The override wins over the built-in Gym tint, and only for the first place.
    const inGym = toFcEvent(event({ locations: ["Gym", "Fields"] }), BY_ID, undefined, "location", colors);
    expect(tintOf(inGym)).toBe("#e0b15a");
    // A place with no override still reads its built-in default.
    const inFields = toFcEvent(event({ locations: ["Fields"] }), BY_ID, undefined, "location", colors);
    expect(tintOf(inFields)).toBe(LOCATION_TINTS.Fields);
    // An override on a place the event isn't in changes nothing.
    const stillGym = toFcEvent(event({ locations: ["Gym"] }), BY_ID, undefined, "location", { Pool: "#000000" });
    expect(tintOf(stillGym)).toBe(LOCATION_TINTS.Gym);
  });

  it("theme mode uses the activity's theme tint, else the neutral", () => {
    const theme: Theme = { id: "ocean", label: "Ocean Week", tint: "#4d7a86" };
    const themeOf = (id: string) => (id === ACTIVITY.id ? theme : null);
    expect(tintOf(toFcEvent(event(), BY_ID, themeOf, "theme"))).toBe(theme.tint);
    // No theme on this activity → the neutral stone.
    expect(tintOf(toFcEvent(event(), BY_ID, () => null, "theme"))).toBe(CUSTOM_NEUTRAL);
  });
});
