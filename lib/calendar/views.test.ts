import { describe, expect, it } from "vitest";
import {
  clampNDays,
  DEFAULT_WEEK_START,
  isNDaysView,
  nDayRange,
  NDAYS_MAX,
  NDAYS_MIN,
  parseStoredView,
  parseWeekStart,
  viewKeyId,
  viewTitle,
  type StoredViewPref,
} from "./views";

describe("clampNDays", () => {
  it("keeps in-range values", () => {
    expect(clampNDays(2)).toBe(2);
    expect(clampNDays(5)).toBe(5);
    expect(clampNDays(9)).toBe(9);
  });

  it("clamps below/above the 2–9 range", () => {
    expect(clampNDays(1)).toBe(NDAYS_MIN);
    expect(clampNDays(0)).toBe(NDAYS_MIN);
    expect(clampNDays(-3)).toBe(NDAYS_MIN);
    expect(clampNDays(12)).toBe(NDAYS_MAX);
  });

  it("rounds and survives garbage", () => {
    expect(clampNDays(4.6)).toBe(5);
    expect(clampNDays(Number.NaN)).toBe(NDAYS_MIN);
    expect(clampNDays(Infinity)).toBe(NDAYS_MAX);
  });
});

describe("isNDaysView / viewKeyId", () => {
  it("discriminates the union", () => {
    expect(isNDaysView("timeGridWeek")).toBe(false);
    expect(isNDaysView({ type: "ndays", n: 3 })).toBe(true);
  });

  it("produces a stable id", () => {
    expect(viewKeyId("timeGridDay")).toBe("timeGridDay");
    expect(viewKeyId({ type: "ndays", n: 4 })).toBe("ndays:4");
    expect(viewKeyId({ type: "ndays", n: 99 })).toBe("ndays:9"); // clamped
  });
});

describe("nDayRange", () => {
  it("starts on the anchor's day and runs N days (end exclusive)", () => {
    const { start, end } = nDayRange(new Date(2026, 5, 18), 5); // Jun 18
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(5);
    expect(start.getDate()).toBe(18);
    expect(end.getDate()).toBe(23); // 18 + 5
  });

  it("strips any time-of-day from the anchor", () => {
    const { start } = nDayRange(new Date(2026, 5, 18, 14, 37), 3);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it("crosses a month boundary correctly", () => {
    const { start, end } = nDayRange(new Date(2026, 5, 29), 5); // Jun 29
    expect(start.getMonth()).toBe(5);
    expect(end.getMonth()).toBe(6); // July
    expect(end.getDate()).toBe(4); // Jun 29 + 5 = Jul 4
  });

  it("clamps N before building the range", () => {
    const { start, end } = nDayRange(new Date(2026, 0, 1), 99);
    expect(Math.round((end.getTime() - start.getTime()) / 86_400_000)).toBe(NDAYS_MAX);
  });
});

describe("viewTitle", () => {
  it("renders a single day (Day view, n=1) without flooring to a range", () => {
    expect(viewTitle(new Date(2026, 5, 18), 1)).toBe("Jun 18, 2026");
  });

  it("collapses a same-month window", () => {
    expect(viewTitle(new Date(2026, 5, 18), 5)).toBe("Jun 18 – 22, 2026");
  });

  it("spells both months across a month boundary", () => {
    expect(viewTitle(new Date(2026, 5, 29), 5)).toBe("Jun 29 – Jul 3, 2026");
  });

  it("spells both years across New Year", () => {
    // Dec 30, 2026 + 4 days inclusive → Jan 2, 2027
    expect(viewTitle(new Date(2026, 11, 30), 4)).toBe("Dec 30, 2026 – Jan 2, 2027");
  });
});

describe("parseStoredView", () => {
  const fallback: StoredViewPref = "auto";

  it("accepts the legacy fixed-view literals and auto", () => {
    expect(parseStoredView("auto", fallback)).toBe("auto");
    expect(parseStoredView("timeGridDay", fallback)).toBe("timeGridDay");
    expect(parseStoredView("timeGridWeek", fallback)).toBe("timeGridWeek");
    expect(parseStoredView("dayGridMonth", fallback)).toBe("dayGridMonth");
  });

  it("round-trips the N-day object form (clamping N)", () => {
    expect(parseStoredView({ type: "ndays", n: 5 }, fallback)).toEqual({ type: "ndays", n: 5 });
    expect(parseStoredView({ type: "ndays", n: 50 }, fallback)).toEqual({ type: "ndays", n: NDAYS_MAX });
  });

  it("tolerates a string ndays form", () => {
    expect(parseStoredView("ndays:3", fallback)).toEqual({ type: "ndays", n: 3 });
  });

  it("falls back on anything unrecognized", () => {
    expect(parseStoredView("garbage", fallback)).toBe("auto");
    expect(parseStoredView(42, fallback)).toBe("auto");
    expect(parseStoredView(null, fallback)).toBe("auto");
    expect(parseStoredView({ type: "ndays", n: "x" }, fallback)).toBe("auto");
  });
});

describe("parseWeekStart", () => {
  it("accepts the two valid weekday indices", () => {
    expect(parseWeekStart(0)).toBe(0); // Sunday
    expect(parseWeekStart(1)).toBe(1); // Monday
  });

  it("falls back (default Monday) on anything else", () => {
    expect(parseWeekStart(undefined)).toBe(DEFAULT_WEEK_START);
    expect(parseWeekStart(2)).toBe(DEFAULT_WEEK_START); // no mid-week starts
    expect(parseWeekStart(6)).toBe(DEFAULT_WEEK_START);
    expect(parseWeekStart("1")).toBe(DEFAULT_WEEK_START); // string isn't 0|1
    expect(parseWeekStart(null)).toBe(DEFAULT_WEEK_START);
  });

  it("honours an explicit fallback", () => {
    expect(parseWeekStart("x", 0)).toBe(0);
  });
});
