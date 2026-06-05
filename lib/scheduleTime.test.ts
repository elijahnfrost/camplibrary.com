import { describe, expect, it } from "vitest";
import type { ScheduleBlock } from "./types";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  DEFAULT_DURATION_MIN,
  DEFAULT_PLANNING_START_MIN,
  SNAP_MIN,
  blockEndMin,
  blockStartMin,
  campMinutes,
  clampStart,
  formatClock,
  formatRange,
  minutesToCamp,
  nextFreeStart,
  normalizeTimeString,
  snapMinutes,
  startOptions,
} from "./scheduleTime";

function block(partial: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: partial.id ?? "b1",
    start: partial.start ?? "09:00",
    end: partial.end ?? "09:30",
    kind: partial.kind ?? "label",
    label: partial.label ?? "Block",
    ...partial,
  };
}

describe("schedule time helpers", () => {
  it("parses canonical and legacy camp time strings", () => {
    expect(campMinutes("09:30")).toBe(570);
    expect(campMinutes("1:30")).toBe(810);
    expect(campMinutes("5")).toBe(1020);
    expect(campMinutes("6")).toBe(360);
    expect(campMinutes("bad")).toBe(DEFAULT_PLANNING_START_MIN);
    expect(campMinutes("9x")).toBe(540);
  });

  it("formats and normalizes storage times", () => {
    expect(minutesToCamp(540)).toBe("09:00");
    expect(minutesToCamp(810)).toBe("13:30");
    expect(minutesToCamp(-10)).toBe("00:00");
    expect(minutesToCamp(1440)).toBe("24:00");
    expect(minutesToCamp(1441)).toBe("24:00");
    expect(minutesToCamp(547.6)).toBe("09:08");

    expect(normalizeTimeString("1:30")).toBe("13:30");
    expect(normalizeTimeString("24:00")).toBe("24:00");
    expect(normalizeTimeString("24:30")).toBe("23:59");
    expect(normalizeTimeString("bad")).toBe("09:00");
  });

  it("renders readable clock labels and ranges", () => {
    expect(formatClock(540)).toBe("9:00 am");
    expect(formatClock(780)).toBe("1:00 pm");
    expect(formatClock(480, true)).toBe("8 am");
    expect(formatClock(1440)).toBe("12:00 am");
    expect(formatClock("1:30")).toBe("1:30 pm");
    expect(formatRange(540, 585)).toBe("9:00 am \u2013 9:45 am");
  });

  it("snaps and clamps planner positions", () => {
    expect(SNAP_MIN).toBe(15);
    expect(snapMinutes(547)).toBe(540);
    expect(snapMinutes(548)).toBe(555);
    expect(snapMinutes(548, 10)).toBe(550);

    expect(clampStart(300, 30)).toBe(DAY_START_MIN);
    expect(clampStart(600, 30)).toBe(600);
    expect(clampStart(1200, 30)).toBe(DAY_END_MIN - 30);
    expect(clampStart(1080, 120)).toBe(DAY_END_MIN - 120);
  });

  it("builds visible-day start options", () => {
    const options = startOptions();

    expect(options).toHaveLength(40);
    expect(options[0]).toEqual({ value: "08:00", label: "8:00 am" });
    expect(options.at(-1)).toEqual({ value: "17:45", label: "5:45 pm" });
  });

  it("derives block start and end minutes with fallback durations", () => {
    expect(DEFAULT_DURATION_MIN).toBe(30);
    expect(blockStartMin(block({ start: "09:00" }))).toBe(540);
    expect(blockStartMin(block({ start: "bad" }))).toBe(DEFAULT_PLANNING_START_MIN);
    expect(blockEndMin(block({ start: "09:00", end: "" }))).toBe(570);
    expect(blockEndMin(block({ start: "10:00", end: "09:00" }))).toBe(630);
    expect(blockEndMin(block({ start: "10:00", end: "bad" }))).toBe(630);
  });

  it("finds the next free snapped start inside the camp day", () => {
    expect(nextFreeStart([], 30)).toBe(DEFAULT_PLANNING_START_MIN);
    expect(
      nextFreeStart(
        [
          block({ id: "a", start: "09:00", end: "09:30" }),
          block({ id: "b", start: "09:45", end: "10:15" }),
        ],
        30
      )
    ).toBe(615);
    expect(nextFreeStart([block({ start: "09:00", end: "18:00" })], 30)).toBe(480);
    expect(nextFreeStart([block({ start: "08:00", end: "18:00" })], 30)).toBe(1050);
    expect(nextFreeStart([block({ start: "09:00", end: "09:30" })], 30)).toBe(570);
  });
});
