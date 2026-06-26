import { describe, expect, it } from "vitest";
import { applyMoveDelta, moveDelta, orderEventIds, rangeSelection } from "./selection";
import type { CalendarEvent } from "./types";

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "a",
    date: "2026-06-22",
    startMin: 540,
    endMin: 600,
    kind: "custom",
    title: "Block",
    updatedAt: 0,
    ...overrides,
  };
}

describe("orderEventIds", () => {
  it("sorts by date, then startMin, then id", () => {
    const events = [
      event({ id: "z", date: "2026-06-23", startMin: 540 }),
      event({ id: "b", date: "2026-06-22", startMin: 600 }),
      event({ id: "a", date: "2026-06-22", startMin: 540 }),
      event({ id: "c", date: "2026-06-22", startMin: 540 }),
    ];
    expect(orderEventIds(events)).toEqual(["a", "c", "b", "z"]);
  });

  it("is stable regardless of input order", () => {
    const a = event({ id: "a", date: "2026-06-22", startMin: 540 });
    const b = event({ id: "b", date: "2026-06-22", startMin: 600 });
    expect(orderEventIds([a, b])).toEqual(orderEventIds([b, a]));
  });
});

describe("rangeSelection", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("includes both endpoints and everything between (forward)", () => {
    expect([...rangeSelection(order, "b", "d")]).toEqual(["b", "c", "d"]);
  });

  it("works when the target is before the anchor", () => {
    expect([...rangeSelection(order, "d", "b")]).toEqual(["b", "c", "d"]);
  });

  it("spans the whole order anchor→target across the range", () => {
    expect([...rangeSelection(order, "a", "e")]).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("collapses to the lone endpoint for a one-item range", () => {
    expect([...rangeSelection(order, "c", "c")]).toEqual(["c"]);
  });

  it("degrades to just the target when an id is missing", () => {
    expect([...rangeSelection(order, "missing", "c")]).toEqual(["c"]);
  });
});

describe("moveDelta", () => {
  it("derives day + minute shift from before/after", () => {
    const before = event({ date: "2026-06-22", startMin: 540 });
    const after = event({ date: "2026-06-24", startMin: 600 });
    expect(moveDelta(before, after)).toEqual({ dayDelta: 2, minDelta: 60 });
  });

  it("handles negative shifts", () => {
    const before = event({ date: "2026-06-24", startMin: 600 });
    const after = event({ date: "2026-06-22", startMin: 540 });
    expect(moveDelta(before, after)).toEqual({ dayDelta: -2, minDelta: -60 });
  });

  it("is time-flat for an all-day move (only day shifts)", () => {
    const before = event({ date: "2026-06-22", allDay: true, startMin: 0, endMin: 0 });
    const after = event({ date: "2026-06-23", allDay: true, startMin: 0, endMin: 0 });
    expect(moveDelta(before, after)).toEqual({ dayDelta: 1, minDelta: 0 });
  });
});

describe("applyMoveDelta", () => {
  it("shifts another event by the same day + minute delta, preserving duration", () => {
    const other = event({ id: "b", date: "2026-06-22", startMin: 660, endMin: 720 });
    const moved = applyMoveDelta(other, { dayDelta: 2, minDelta: 60 });
    expect(moved.date).toBe("2026-06-24");
    expect(moved.startMin).toBe(720);
    expect(moved.endMin).toBe(780); // duration (60) preserved
  });

  it("snaps the shifted start to the 15-min grid", () => {
    const other = event({ id: "b", startMin: 540, endMin: 600 });
    const moved = applyMoveDelta(other, { dayDelta: 0, minDelta: 7 });
    expect(moved.startMin % 15).toBe(0);
  });

  it("clamps within the day so a move can't push a block out of bounds", () => {
    const other = event({ id: "b", startMin: 1380, endMin: 1440 }); // 23:00–24:00
    const moved = applyMoveDelta(other, { dayDelta: 0, minDelta: 120 }); // +2h would overflow
    expect(moved.endMin).toBeLessThanOrEqual(1440);
    expect(moved.endMin - moved.startMin).toBe(60); // duration intact
  });

  it("only shifts the day for an all-day event", () => {
    const other = event({ id: "b", date: "2026-06-22", allDay: true, startMin: 0, endMin: 0 });
    const moved = applyMoveDelta(other, { dayDelta: 1, minDelta: 0 });
    expect(moved.date).toBe("2026-06-23");
    expect(moved.allDay).toBe(true);
  });

  it("bumps updatedAt so the last-write-wins store re-accepts the row", () => {
    const other = event({ id: "b", updatedAt: 0 });
    const moved = applyMoveDelta(other, { dayDelta: 1, minDelta: 0 });
    expect(moved.updatedAt).toBeGreaterThan(0);
  });
});
