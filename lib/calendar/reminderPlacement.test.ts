import { describe, expect, it } from "vitest";
import { isTightGapBetweenEvents } from "./reminderPlacement";
import type { CalendarEvent } from "./types";

const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: Math.random().toString(36).slice(2),
  date: "2026-06-28",
  startMin: 600,
  endMin: 630,
  kind: "custom",
  title: "Event",
  updatedAt: 0,
  ...over,
});

describe("isTightGapBetweenEvents", () => {
  const day = "2026-06-28";

  it("is true in a tight gap squeezed between two events", () => {
    const events = [ev({ startMin: 540, endMin: 600 }), ev({ startMin: 615, endMin: 700 })];
    // Tap at 10:05 (605) — gap 600→615 is 15 min, well under the 30-min ceiling.
    expect(isTightGapBetweenEvents(events, day, 605)).toBe(true);
  });

  it("is true exactly at the 30-min gap ceiling", () => {
    const events = [ev({ startMin: 540, endMin: 600 }), ev({ startMin: 630, endMin: 700 })];
    expect(isTightGapBetweenEvents(events, day, 615)).toBe(true);
  });

  it("is false when the gap is wide enough to hold a block", () => {
    const events = [ev({ startMin: 540, endMin: 600 }), ev({ startMin: 660, endMin: 700 })];
    // 60-min gap → a real event fits, so a tap there is an event, not a reminder.
    expect(isTightGapBetweenEvents(events, day, 615)).toBe(false);
  });

  it("is false in open space with no event after the tap", () => {
    const events = [ev({ startMin: 540, endMin: 600 })];
    expect(isTightGapBetweenEvents(events, day, 605)).toBe(false);
  });

  it("is false in open space with no event before the tap", () => {
    const events = [ev({ startMin: 660, endMin: 700 })];
    expect(isTightGapBetweenEvents(events, day, 605)).toBe(false);
  });

  it("is false when the tap lands inside an event", () => {
    const events = [ev({ startMin: 540, endMin: 620 }), ev({ startMin: 630, endMin: 700 })];
    // 610 is inside the first event (540–620), not a gap.
    expect(isTightGapBetweenEvents(events, day, 610)).toBe(false);
  });

  it("treats an event boundary as the gap edge (tap at a prior event's end)", () => {
    const events = [ev({ startMin: 540, endMin: 600 }), ev({ startMin: 615, endMin: 700 })];
    // 600 == first event's end (exclusive), so it's the gap, not inside it.
    expect(isTightGapBetweenEvents(events, day, 600)).toBe(true);
  });

  it("ignores 0-min reminders and all-day events when measuring the gap", () => {
    const events = [
      ev({ startMin: 540, endMin: 600 }),
      ev({ startMin: 615, endMin: 700 }),
      ev({ startMin: 605, endMin: 605, title: "Bathroom" }), // 0-min reminder
      ev({ allDay: true, startMin: 0, endMin: 0, title: "Field trip" }),
    ];
    expect(isTightGapBetweenEvents(events, day, 605)).toBe(true);
  });

  it("only considers events on the same day", () => {
    const events = [
      ev({ date: "2026-06-27", startMin: 540, endMin: 600 }),
      ev({ date: "2026-06-29", startMin: 615, endMin: 700 }),
    ];
    expect(isTightGapBetweenEvents(events, day, 605)).toBe(false);
  });
});
