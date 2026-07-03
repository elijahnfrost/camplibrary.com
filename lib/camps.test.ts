import { describe, expect, it } from "vitest";
import {
  campDayWindow,
  clampOpenClose,
  DEFAULT_CLOSE_MIN,
  DEFAULT_OPEN_MIN,
  EARLIEST_OPEN_MIN,
  LATEST_CLOSE_MIN,
  MAX_CAMP_NAME,
  normalizeCamps,
  withCampClose,
  withCampOpen,
  type Camp,
} from "./camps";
import { normalizeCalendarEvent } from "./calendar/types";
import { DAY_END_MIN, DAY_START_MIN } from "./calendar/time";

const camp = (over: Partial<Camp> = {}): Camp => ({
  id: "c1",
  name: "Summer",
  createdAt: 0,
  openMin: DEFAULT_OPEN_MIN,
  closeMin: DEFAULT_CLOSE_MIN,
  ...over,
});

describe("camps normalization", () => {
  it("keeps well-formed camps and drops malformed ones", () => {
    const result = normalizeCamps(
      [
        { id: "c1", name: "Summer Day Camp", createdAt: 100 },
        { id: "", name: "No id" },
        { id: "c2", name: "" },
        { id: "c3", name: "Spring Break" },
        42,
      ],
      []
    );
    expect(result.map((c) => c.id)).toEqual(["c1", "c3"]);
    // Missing hours default to the historical camp day.
    expect(result[0]).toEqual({
      id: "c1",
      name: "Summer Day Camp",
      createdAt: 100,
      openMin: DEFAULT_OPEN_MIN,
      closeMin: DEFAULT_CLOSE_MIN,
    });
    // Missing createdAt defaults to 0.
    expect(result[1].createdAt).toBe(0);
  });

  it("trims names, caps length, and dedupes by id", () => {
    const longName = "x".repeat(MAX_CAMP_NAME + 20);
    const result = normalizeCamps(
      [
        { id: "c1", name: "  Summer  " },
        { id: "c1", name: "Duplicate" },
        { id: "c2", name: longName },
      ],
      []
    );
    expect(result.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(result[0].name).toBe("Summer");
    expect(result[1].name.length).toBe(MAX_CAMP_NAME);
  });

  it("clamps stored hours onto the grid and inside the selectable range", () => {
    const out = normalizeCamps(
      [{ id: "c1", name: "A", createdAt: 0, openMin: -100, closeMin: 100 * 60 }],
      []
    );
    expect(out[0].openMin).toBe(EARLIEST_OPEN_MIN);
    expect(out[0].closeMin).toBe(LATEST_CLOSE_MIN);
  });

  it("snaps off-grid hours and forces open strictly before close", () => {
    const offGrid = normalizeCamps(
      [{ id: "c1", name: "A", createdAt: 0, openMin: 7 * 60 + 7, closeMin: 17 * 60 + 9 }],
      []
    );
    expect(offGrid[0].openMin % 15).toBe(0);
    expect(offGrid[0].closeMin % 15).toBe(0);

    const collapsed = normalizeCamps(
      [{ id: "c1", name: "A", createdAt: 0, openMin: 12 * 60, closeMin: 12 * 60 }],
      []
    );
    expect(collapsed[0].openMin).toBeLessThan(collapsed[0].closeMin);
  });

  it("falls back when the value is not an array", () => {
    const fallback: Camp[] = [camp({ id: "f", name: "Fallback" })];
    expect(normalizeCamps("nope", fallback)).toBe(fallback);
    expect(normalizeCamps(null, fallback)).toBe(fallback);
  });
});

describe("campDayWindow", () => {
  it("uses the camp's own hours", () => {
    expect(campDayWindow(camp({ openMin: 8 * 60, closeMin: 17 * 60 }))).toEqual({
      startMin: 8 * 60,
      endMin: 17 * 60,
    });
  });

  it("falls back to the classic 8–18 band with no active camp", () => {
    expect(campDayWindow(null)).toEqual({ startMin: DAY_START_MIN, endMin: DAY_END_MIN });
  });
});

describe("withCampOpen / withCampClose / clampOpenClose", () => {
  it("pushes close out when open crosses it", () => {
    const next = withCampOpen(camp({ openMin: 8 * 60, closeMin: 9 * 60 }), 10 * 60);
    expect(next.openMin).toBe(10 * 60);
    expect(next.closeMin).toBeGreaterThan(next.openMin);
  });

  it("pulls open in when close crosses it", () => {
    const next = withCampClose(camp({ openMin: 9 * 60, closeMin: 17 * 60 }), 8 * 60);
    expect(next.closeMin).toBe(8 * 60);
    expect(next.openMin).toBeLessThan(next.closeMin);
  });

  it("clampOpenClose keeps both inside the selectable range", () => {
    expect(clampOpenClose(0, 100 * 60)).toEqual({
      openMin: EARLIEST_OPEN_MIN,
      closeMin: LATEST_CLOSE_MIN,
    });
  });
});

describe("calendar event campId round-trip", () => {
  it("preserves a string campId and drops a non-string one", () => {
    const withCamp = normalizeCalendarEvent({
      id: "e1",
      date: "2026-06-14",
      startMin: 540,
      endMin: 600,
      kind: "custom",
      title: "Lunch",
      campId: "camp-summer",
      updatedAt: 1,
    });
    expect(withCamp?.campId).toBe("camp-summer");

    const badCamp = normalizeCalendarEvent({
      id: "e2",
      date: "2026-06-14",
      startMin: 540,
      endMin: 600,
      kind: "custom",
      title: "Lunch",
      campId: 7,
      updatedAt: 1,
    });
    expect(badCamp?.campId).toBeUndefined();
  });
});

describe("normalizeCamp forward compatibility", () => {
  it("round-trips keys this build doesn't know while still clamping known fields", () => {
    const [out] = normalizeCamps(
      [
        {
          id: "c1",
          name: "Summer",
          createdAt: 1,
          openMin: 300, // below the selectable floor -> clamped
          closeMin: 9999, // above the ceiling -> clamped
          snapMin: 10, // a newer client's field: must survive the round-trip
          weekdayHours: { 5: null },
        },
      ],
      []
    );
    const raw = out as unknown as Record<string, unknown>;
    expect(raw.snapMin).toBe(10);
    expect(raw.weekdayHours).toEqual({ 5: null });
    expect(out.openMin).toBe(EARLIEST_OPEN_MIN);
    expect(out.closeMin).toBe(LATEST_CLOSE_MIN);
  });
});
