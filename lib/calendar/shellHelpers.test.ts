import { describe, expect, it } from "vitest";
import { MINUTES_PER_DAY, snapDurationMin } from "@/lib/calendar/time";
import { clampNDays } from "@/lib/calendar/views";
import {
  boolStorage,
  clampSlotZoom,
  colorModeStorage,
  endMinForDraft,
  fcType,
  parseDismissedRainDays,
  parseRainThreshold,
  slotZoomStorage,
  stableStringify,
  targetDaysFor,
  SLOT_ZOOM_FLOOR,
  SLOT_ZOOM_MAX,
} from "./shellHelpers";

describe("clampSlotZoom", () => {
  it("clamps into [SLOT_ZOOM_FLOOR, SLOT_ZOOM_MAX]", () => {
    expect(clampSlotZoom(1)).toBe(1);
    expect(clampSlotZoom(99)).toBe(SLOT_ZOOM_MAX);
    expect(clampSlotZoom(0)).toBe(SLOT_ZOOM_FLOOR);
  });
});

describe("fcType / targetDaysFor", () => {
  it("only Month is its own grid; every timed view is the strip", () => {
    expect(fcType("dayGridMonth")).toBe("dayGridMonth");
    expect(fcType("timeGridDay")).toBe("timeGridStrip");
    expect(fcType("timeGridWeek")).toBe("timeGridStrip");
    expect(fcType({ type: "ndays", n: 4 })).toBe("timeGridStrip");
  });
  it("maps a view to how many days fill the viewport", () => {
    expect(targetDaysFor("timeGridDay")).toBe(1);
    expect(targetDaysFor("timeGridWeek")).toBe(7);
    expect(targetDaysFor("dayGridMonth")).toBe(7);
    expect(targetDaysFor({ type: "ndays", n: 3 })).toBe(clampNDays(3));
  });
});

describe("endMinForDraft", () => {
  it("all-day is 0, a 0-length reminder equals its start", () => {
    expect(endMinForDraft(600, 30, true)).toBe(0);
    expect(endMinForDraft(600, 0, false)).toBe(600);
    expect(endMinForDraft(600, -5, false)).toBe(600);
  });
  it("otherwise adds the snapped length, clamped to end of day", () => {
    expect(endMinForDraft(600, 30, false)).toBe(600 + snapDurationMin(30));
    expect(endMinForDraft(MINUTES_PER_DAY - 10, 600, false)).toBe(MINUTES_PER_DAY);
  });
});

describe("stableStringify", () => {
  it("is key-order independent but preserves array order", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });
  it("recurses into nested objects and handles primitives", () => {
    expect(stableStringify({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify("hi")).toBe('"hi"');
  });
});

describe("storage validators", () => {
  it("boolStorage falls back on non-booleans", () => {
    expect(boolStorage(true, false)).toBe(true);
    expect(boolStorage("x", false)).toBe(false);
    expect(boolStorage(undefined, true)).toBe(true);
  });
  it("slotZoomStorage clamps a finite number, else falls back", () => {
    expect(slotZoomStorage(2, 1)).toBe(2);
    expect(slotZoomStorage(99, 1)).toBe(SLOT_ZOOM_MAX);
    expect(slotZoomStorage(Number.NaN, 1)).toBe(1);
    expect(slotZoomStorage("2", 1)).toBe(1);
  });
  it("colorModeStorage accepts known modes only", () => {
    expect(colorModeStorage("type", "custom")).toBe("type");
    expect(colorModeStorage("bogus", "custom")).toBe("custom");
  });
});

describe("rain prefs", () => {
  it("parseRainThreshold accepts only the whitelist numbers", () => {
    expect(parseRainThreshold(30, 0)).toBe(30);
    expect(parseRainThreshold(45, 0)).toBe(0);
    expect(parseRainThreshold("30", 0)).toBe(0);
  });
  it("parseDismissedRainDays keeps well-formed future dates, deduped", () => {
    expect(parseDismissedRainDays("nope", ["2999-01-01"])).toEqual(["2999-01-01"]);
    expect(
      parseDismissedRainDays(["2999-12-31", "2999-12-31", "2000-01-01", "garbage"], []),
    ).toEqual(["2999-12-31"]);
  });
});
