import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMP_HOURS,
  EARLIEST_OPEN_MIN,
  LATEST_CLOSE_MIN,
  normalizeCampHours,
  windowFromCampHours,
  withClose,
  withOpen,
  type CampHoursMap,
} from "./hours";
import { SNAP_MIN, effectiveWindow } from "./time";
import type { CalendarEvent } from "./types";

const clone = (hours: CampHoursMap): CampHoursMap =>
  Object.fromEntries(Object.entries(hours).map(([id, camp]) => [id, { ...camp }])) as CampHoursMap;

function event(startMin: number, endMin: number): CalendarEvent {
  return { id: "e", date: "2026-06-14", startMin, endMin, kind: "custom", title: "x", updatedAt: 0 };
}

describe("windowFromCampHours", () => {
  it("unions the enabled camps — pre-K's 8:00 and the older camps' 7:30 give a 7:30 grid", () => {
    expect(windowFromCampHours(DEFAULT_CAMP_HOURS)).toEqual({ startMin: 7 * 60 + 30, endMin: 18 * 60 });
  });

  it("ignores a disabled camp", () => {
    const hours = clone(DEFAULT_CAMP_HOURS);
    hours.g13.enabled = false; // the other 7:30 camp...
    hours.g46.enabled = false; // ...both off → only pre-K (8:00) remains
    expect(windowFromCampHours(hours)).toEqual({ startMin: 8 * 60, endMin: 18 * 60 });
  });

  it("falls back to the standard day when no camp is enabled", () => {
    const hours = clone(DEFAULT_CAMP_HOURS);
    hours.pre.enabled = false;
    hours.g13.enabled = false;
    hours.g46.enabled = false;
    expect(windowFromCampHours(hours)).toEqual({ startMin: 8 * 60, endMin: 18 * 60 });
  });

  it("takes the widest open/close across camps", () => {
    const hours = clone(DEFAULT_CAMP_HOURS);
    hours.pre.openMin = 6 * 60 + 30;
    hours.g46.closeMin = 19 * 60;
    expect(windowFromCampHours(hours)).toEqual({ startMin: 6 * 60 + 30, endMin: 19 * 60 });
  });
});

describe("withOpen / withClose", () => {
  it("pushes close out when open is dragged past it", () => {
    const camp = { enabled: true, openMin: 8 * 60, closeMin: 9 * 60 };
    const next = withOpen(camp, 9 * 60);
    expect(next.openMin).toBe(9 * 60);
    expect(next.closeMin).toBe(9 * 60 + SNAP_MIN);
  });

  it("pulls open in when close is dragged before it", () => {
    const camp = { enabled: true, openMin: 8 * 60, closeMin: 17 * 60 };
    const next = withClose(camp, 8 * 60);
    expect(next.closeMin).toBe(8 * 60);
    expect(next.openMin).toBe(8 * 60 - SNAP_MIN);
  });

  it("clamps to the selectable range", () => {
    const camp = { enabled: true, openMin: 8 * 60, closeMin: 18 * 60 };
    expect(withOpen(camp, 0).openMin).toBe(EARLIEST_OPEN_MIN);
    expect(withClose(camp, 23 * 60).closeMin).toBe(LATEST_CLOSE_MIN);
  });
});

describe("normalizeCampHours", () => {
  it("returns defaults for non-objects", () => {
    expect(normalizeCampHours(null)).toEqual(DEFAULT_CAMP_HOURS);
    expect(normalizeCampHours("nope")).toEqual(DEFAULT_CAMP_HOURS);
  });

  it("fills missing camps and fields from defaults", () => {
    const parsed = normalizeCampHours({ pre: { openMin: 9 * 60 } });
    expect(parsed.pre).toEqual({ enabled: true, openMin: 9 * 60, closeMin: 18 * 60 });
    expect(parsed.g13).toEqual(DEFAULT_CAMP_HOURS.g13);
  });

  it("clamps out-of-range and snaps off-grid values", () => {
    const parsed = normalizeCampHours({ pre: { openMin: -100, closeMin: 100 * 60 } });
    expect(parsed.pre.openMin).toBe(EARLIEST_OPEN_MIN);
    expect(parsed.pre.closeMin).toBe(LATEST_CLOSE_MIN);
    const offGrid = normalizeCampHours({ g13: { openMin: 7 * 60 + 7, closeMin: 17 * 60 + 9 } });
    expect(offGrid.g13.openMin % SNAP_MIN).toBe(0);
    expect(offGrid.g13.closeMin % SNAP_MIN).toBe(0);
  });

  it("repairs open >= close so open stays strictly before close", () => {
    const parsed = normalizeCampHours({ pre: { openMin: 12 * 60, closeMin: 12 * 60 } });
    expect(parsed.pre.closeMin).toBeGreaterThan(parsed.pre.openMin);
  });
});

describe("effectiveWindow with a camp-hours base", () => {
  it("extends outward around stray events but never narrows the base", () => {
    const base = { startMin: 8 * 60, endMin: 18 * 60 };
    // A 7:15 event floors the start to 7:00; an event inside the base leaves it.
    expect(effectiveWindow([event(7 * 60 + 15, 8 * 60)], base)).toEqual({ startMin: 7 * 60, endMin: 18 * 60 });
    expect(effectiveWindow([event(10 * 60, 11 * 60)], base)).toEqual(base);
  });
});
