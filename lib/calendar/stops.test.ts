import { describe, expect, it } from "vitest";
import { groupStops, stopEventIds } from "./stops";
import type { CalendarEvent } from "./types";

let n = 0;
const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e" + n++,
  date: "2026-06-28",
  startMin: 600,
  endMin: 630,
  kind: "custom",
  title: "Event",
  updatedAt: 0,
  ...over,
});

describe("groupStops", () => {
  it("does not make a solo non-zero event a stop", () => {
    const stops = groupStops([ev({ startMin: 600, endMin: 630 })]);
    expect(stops).toHaveLength(0);
  });

  it("does NOT group two real events sharing one start — only reminders form stops", () => {
    const a = ev({ startMin: 600, endMin: 660, title: "Plan A" });
    const b = ev({ startMin: 600, endMin: 645, title: "Plan B" });
    // Two real events dragged onto the same start stay native FC cards (laid out
    // side by side), never merged into a multi-event block.
    expect(groupStops([a, b])).toHaveLength(0);
  });

  it("treats a solo 0-min event as a stop (a reminder)", () => {
    const stops = groupStops([ev({ startMin: 600, endMin: 600, title: "Bathroom" })]);
    expect(stops).toHaveLength(1);
    expect(stops[0].events).toHaveLength(1);
  });

  it("groups several 0-min reminders at one time into one stop", () => {
    const stops = groupStops([
      ev({ startMin: 600, endMin: 600, title: "Bathroom" }),
      ev({ startMin: 600, endMin: 600, title: "Sunscreen" }),
      ev({ startMin: 600, endMin: 600, title: "Trash" }),
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0].events).toHaveLength(3);
  });

  it("a reminder sharing a real event's start makes a reminder-only stop", () => {
    const reminder = ev({ startMin: 600, endMin: 600, title: "Reminder" });
    const real = ev({ startMin: 600, endMin: 660, title: "Real" });
    const stops = groupStops([reminder, real]);
    // Only the reminder is a stop; the real event stays a native FC card.
    expect(stops).toHaveLength(1);
    expect(stops[0].events).toHaveLength(1);
    expect(stops[0].events[0].title).toBe("Reminder");
  });

  it("does not group non-zero events at different starts, or all-day events", () => {
    const stops = groupStops([
      ev({ startMin: 600, endMin: 630 }),
      ev({ startMin: 645, endMin: 700 }),
      ev({ allDay: true, startMin: 0, endMin: 0 }),
    ]);
    expect(stops).toHaveLength(0);
  });

  it("separates same start time on different days", () => {
    const stops = groupStops([
      ev({ date: "2026-06-28", startMin: 600, endMin: 600 }),
      ev({ date: "2026-06-29", startMin: 600, endMin: 600 }),
    ]);
    expect(stops).toHaveLength(2);
  });
});

describe("stopEventIds", () => {
  it("collects every id across all stops", () => {
    const a = ev({ startMin: 600, endMin: 600, title: "A" });
    const b = ev({ startMin: 600, endMin: 600, title: "B" });
    const solo = ev({ startMin: 700, endMin: 730 }); // not a stop
    const ids = stopEventIds(groupStops([a, b, solo]));
    expect(ids.has(a.id)).toBe(true);
    expect(ids.has(b.id)).toBe(true);
    expect(ids.has(solo.id)).toBe(false);
  });
});
