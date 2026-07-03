import { describe, expect, it } from "vitest";
import {
  DURATION_OPTIONS,
  SNAP_MIN,
  durationOptionsFor,
  snapDurationString,
  snapMinutes,
} from "./time";

describe("snapMinutes", () => {
  it("defaults to the 15-min grid", () => {
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(22)).toBe(15);
    expect(snapMinutes(23)).toBe(30);
  });

  it("honors a custom snap grid", () => {
    expect(snapMinutes(7, 5)).toBe(5);
    expect(snapMinutes(12, 10)).toBe(10);
    expect(snapMinutes(44, 30)).toBe(30);
    expect(snapMinutes(46, 30)).toBe(60);
  });
});

describe("durationOptionsFor", () => {
  it("matches DURATION_OPTIONS at the 15-min snap (back-compat)", () => {
    expect(durationOptionsFor(15)).toEqual(DURATION_OPTIONS);
    // The default snap is 15, so the two are the same list.
    expect(durationOptionsFor(SNAP_MIN)).toEqual(DURATION_OPTIONS);
  });

  it("falls back to the 15 ladder for an unknown snap", () => {
    expect(durationOptionsFor(7)).toEqual(DURATION_OPTIONS);
    expect(durationOptionsFor(0)).toEqual(DURATION_OPTIONS);
  });

  it("offers a curated ladder per whitelisted snap", () => {
    expect(durationOptionsFor(5)).toEqual([5, 10, 15, 20, 30, 45, 60, 75, 90, 120]);
    expect(durationOptionsFor(10)).toEqual([10, 20, 30, 40, 50, 60, 90, 120]);
    expect(durationOptionsFor(30)).toEqual([30, 60, 90, 120]);
  });

  it("only offers lengths that are multiples of the snap (grid-safe ends)", () => {
    for (const snap of [5, 10, 15, 30]) {
      for (const length of durationOptionsFor(snap)) {
        expect(length % snap).toBe(0);
      }
    }
  });

  it("keeps every ladder sorted ascending and starting at one snap", () => {
    for (const snap of [5, 10, 15, 30]) {
      const ladder = durationOptionsFor(snap);
      expect(ladder[0]).toBe(snap);
      const sorted = [...ladder].sort((a, b) => a - b);
      expect(ladder).toEqual(sorted);
    }
  });
});

describe("snapDurationString", () => {
  it("formats a snap grid as a FullCalendar duration string", () => {
    expect(snapDurationString(5)).toBe("00:05:00");
    expect(snapDurationString(10)).toBe("00:10:00");
    expect(snapDurationString(15)).toBe("00:15:00");
    expect(snapDurationString(30)).toBe("00:30:00");
  });

  it("pads and rolls into an hour when needed", () => {
    expect(snapDurationString(60)).toBe("01:00:00");
    expect(snapDurationString(90)).toBe("01:30:00");
  });

  it("never emits a zero-length grid", () => {
    expect(snapDurationString(0)).toBe("00:01:00");
    expect(snapDurationString(-5)).toBe("00:01:00");
  });
});
