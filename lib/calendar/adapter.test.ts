import { describe, expect, it } from "vitest";
import type { Activity } from "../types";
import { fromFcDates, healEvent, toFcEvent } from "./adapter";
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
