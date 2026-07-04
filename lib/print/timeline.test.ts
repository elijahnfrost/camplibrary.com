import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { ScheduleDay } from "./schedule";
import {
  buildTimelineDays,
  timelineWindow,
  timelineHours,
  timelineFit,
  timelineGridHeightIn,
  TIMELINE_ROW_IN,
  TIMELINE_PAGE_BUDGET_IN,
  type DayWindow,
} from "./timeline";

function ev(partial: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    date: "2026-06-20",
    startMin: 540,
    endMin: 600,
    kind: "custom",
    title: partial.id,
    updatedAt: 0,
    ...partial,
  };
}

function day(date: string, events: CalendarEvent[]): ScheduleDay {
  return { date, events };
}

describe("timelineWindow", () => {
  it("defaults to the camp day (8:00–18:00) with no events", () => {
    expect(timelineWindow([])).toEqual({ startMin: 480, endMin: 1080 });
  });

  it("widens to the hour around an early-morning event", () => {
    const win = timelineWindow([ev({ id: "a", startMin: 6 * 60 + 20, endMin: 7 * 60 })]);
    expect(win.startMin).toBe(6 * 60); // floored to 6:00
    expect(win.endMin).toBe(1080);
  });

  it("widens to the hour around a late event", () => {
    const win = timelineWindow([ev({ id: "a", startMin: 17 * 60, endMin: 19 * 60 + 10 })]);
    expect(win.startMin).toBe(480);
    expect(win.endMin).toBe(20 * 60); // ceiled to 20:00
  });

  it("ignores all-day events when sizing the window", () => {
    const win = timelineWindow([ev({ id: "a", allDay: true, startMin: 0, endMin: 0 })]);
    expect(win).toEqual({ startMin: 480, endMin: 1080 });
  });
});

describe("buildTimelineDays geometry", () => {
  const win: DayWindow = { startMin: 480, endMin: 1080 }; // 8:00–18:00, span 600

  it("positions a block by fraction of the window", () => {
    // 9:00–10:00 → top (540-480)/600 = 10%, height 60/600 = 10%
    const [d] = buildTimelineDays([day("2026-06-20", [ev({ id: "a", startMin: 540, endMin: 600 })])], win);
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0].topPct).toBeCloseTo(10);
    expect(d.blocks[0].heightPct).toBeCloseTo(10);
  });

  it("clips a block that runs past the window edge", () => {
    // 17:00–19:00 clipped to 17:00–18:00 → height 60/600 = 10%, never exceeds 100%
    const [d] = buildTimelineDays([day("2026-06-20", [ev({ id: "a", startMin: 1020, endMin: 1140 })])], win);
    expect(d.blocks[0].topPct).toBeCloseTo(90);
    expect(d.blocks[0].heightPct).toBeCloseTo(10);
    expect(d.blocks[0].topPct + d.blocks[0].heightPct).toBeLessThanOrEqual(100.0001);
  });

  it("separates all-day events from timed blocks", () => {
    const [d] = buildTimelineDays(
      [
        day("2026-06-20", [
          ev({ id: "allday", allDay: true, startMin: 0, endMin: 0 }),
          ev({ id: "timed", startMin: 540, endMin: 600 }),
        ]),
      ],
      win
    );
    expect(d.allDay.map((e) => e.id)).toEqual(["allday"]);
    expect(d.blocks.map((b) => b.event.id)).toEqual(["timed"]);
  });
});

describe("buildTimelineDays lane packing", () => {
  const win: DayWindow = { startMin: 480, endMin: 1080 };

  it("keeps non-overlapping events in a single full-width lane", () => {
    const [d] = buildTimelineDays(
      [
        day("2026-06-20", [
          ev({ id: "a", startMin: 540, endMin: 600 }),
          ev({ id: "b", startMin: 600, endMin: 660 }),
        ]),
      ],
      win
    );
    expect(d.blocks.every((b) => b.cols === 1 && b.col === 0)).toBe(true);
  });

  it("splits two overlapping events into two lanes", () => {
    const [d] = buildTimelineDays(
      [
        day("2026-06-20", [
          ev({ id: "a", startMin: 540, endMin: 660 }),
          ev({ id: "b", startMin: 600, endMin: 720 }),
        ]),
      ],
      win
    );
    const byId = Object.fromEntries(d.blocks.map((b) => [b.event.id, b]));
    expect(byId.a.cols).toBe(2);
    expect(byId.b.cols).toBe(2);
    expect(new Set([byId.a.col, byId.b.col])).toEqual(new Set([0, 1]));
  });

  it("reuses a freed lane once an earlier event ends (back-to-back, not overlapping)", () => {
    // a: 9–10, b: 9–11 (overlap → 2 lanes), c: 10–11 fits lane a vacated.
    const [d] = buildTimelineDays(
      [
        day("2026-06-20", [
          ev({ id: "a", startMin: 540, endMin: 600 }),
          ev({ id: "b", startMin: 540, endMin: 660 }),
          ev({ id: "c", startMin: 600, endMin: 660 }),
        ]),
      ],
      win
    );
    // a,b,c all transitively overlap via b → one cluster of 2 lanes.
    expect(d.blocks.every((b) => b.cols === 2)).toBe(true);
  });

  it("treats adjacent non-overlapping clusters independently", () => {
    const [d] = buildTimelineDays(
      [
        day("2026-06-20", [
          ev({ id: "a", startMin: 540, endMin: 600 }),
          ev({ id: "b", startMin: 540, endMin: 600 }), // overlaps a → cluster 1 (2 lanes)
          ev({ id: "c", startMin: 700, endMin: 760 }), // alone → cluster 2 (1 lane)
        ]),
      ],
      win
    );
    const byId = Object.fromEntries(d.blocks.map((b) => [b.event.id, b]));
    expect(byId.a.cols).toBe(2);
    expect(byId.b.cols).toBe(2);
    expect(byId.c.cols).toBe(1);
  });
});

describe("timelineHours", () => {
  it("lists whole hours from the first hour at/after start through end", () => {
    const hours = timelineHours({ startMin: 450, endMin: 1080 }); // 7:30–18:00
    expect(hours[0].min).toBe(480); // first whole hour is 8:00
    expect(hours[hours.length - 1].min).toBe(1080); // 18:00 inclusive
  });

  it("positions the hour lines by fraction", () => {
    const hours = timelineHours({ startMin: 480, endMin: 1080 });
    expect(hours[0].topPct).toBeCloseTo(0); // 8:00 at the top
    expect(hours[hours.length - 1].topPct).toBeCloseTo(100); // 18:00 at the bottom
  });
});

describe("timelineFit", () => {
  const win: DayWindow = { startMin: 450, endMin: 1080 }; // 7:30–18:00 → 10.5h

  it("fits a normal camp day at regular density", () => {
    const days = buildTimelineDays([day("2026-06-20", [ev({ id: "a" })])], win);
    expect(timelineFit(days, win, "regular").fits).toBe(true);
  });

  it("flags overflow for a wide window at airy density", () => {
    const wide: DayWindow = { startMin: 6 * 60, endMin: 21 * 60 }; // 15h
    const days = buildTimelineDays([day("2026-06-20", [ev({ id: "a", startMin: 6 * 60, endMin: 7 * 60 })])], wide);
    const fit = timelineFit(days, wide, "airy");
    expect(fit.fits).toBe(false);
    expect(fit.tallestIn).toBeGreaterThan(TIMELINE_PAGE_BUDGET_IN);
  });

  it("tight density rescues a window airy can't fit", () => {
    const wide: DayWindow = { startMin: 6 * 60, endMin: 21 * 60 };
    const days = buildTimelineDays([day("2026-06-20", [ev({ id: "a", startMin: 6 * 60, endMin: 7 * 60 })])], wide);
    expect(timelineFit(days, wide, "airy").fits).toBe(false);
    expect(timelineFit(days, wide, "tight").fits).toBe(true);
  });

  it("grid height scales with the per-hour row size", () => {
    expect(timelineGridHeightIn(win, "airy")).toBeCloseTo(10.5 * TIMELINE_ROW_IN.airy);
    expect(timelineGridHeightIn(win, "tight")).toBeCloseTo(10.5 * TIMELINE_ROW_IN.tight);
  });
});
