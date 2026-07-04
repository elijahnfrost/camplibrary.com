import { describe, expect, it } from "vitest";
import { GUIDE_LABEL_MAX, guideBandsForRange, normalizeGuides, type GuideBand } from "./guides";

const band = (over: Partial<GuideBand> = {}): GuideBand => ({
  id: "g1",
  label: "Lunch",
  startMin: 12 * 60,
  endMin: 12 * 60 + 45,
  weekdays: [1, 2, 3, 4, 5],
  ...over,
});

describe("normalizeGuides", () => {
  it("falls back to an empty array on non-arrays", () => {
    expect(normalizeGuides(null)).toEqual([]);
    expect(normalizeGuides("nope")).toEqual([]);
    expect(normalizeGuides({})).toEqual([]);
  });

  it("keeps well-formed bands, dropping malformed ones and deduping by id", () => {
    const out = normalizeGuides([
      { id: "g1", label: "Lunch", startMin: 720, endMin: 765, weekdays: [1, 2, 3] },
      { id: "g1", label: "Duplicate id", startMin: 60, endMin: 120, weekdays: [1] }, // dup id
      { id: "", label: "No id", startMin: 60, endMin: 120, weekdays: [1] }, // no id
      { id: "g2", label: "", startMin: 60, endMin: 120, weekdays: [1] }, // no label
      { id: "g3", label: "Empty weekdays", startMin: 60, endMin: 120, weekdays: [] }, // no weekdays
    ]);
    expect(out.map((b) => b.id)).toEqual(["g1"]);
  });

  it("rejects a zero-length or negative band (0-min stays the reminder discriminator)", () => {
    expect(
      normalizeGuides([{ id: "g1", label: "Point", startMin: 600, endMin: 600, weekdays: [1] }])
    ).toEqual([]);
    expect(
      normalizeGuides([{ id: "g2", label: "Neg", startMin: 600, endMin: 500, weekdays: [1] }])
    ).toEqual([]);
  });

  it("dedupes, sorts, and range-checks weekdays; clamps label length", () => {
    const [b] = normalizeGuides([
      {
        id: "g1",
        label: "x".repeat(GUIDE_LABEL_MAX + 10),
        startMin: 600,
        endMin: 660,
        weekdays: [5, 1, 1, 9, -1, 3],
      },
    ]);
    expect(b.weekdays).toEqual([1, 3, 5]);
    expect(b.label.length).toBe(GUIDE_LABEL_MAX);
  });

  it("keeps optional from/until bounds, dropping a malformed untilKey", () => {
    const [b] = normalizeGuides([
      {
        id: "g1",
        label: "Lunch",
        startMin: 720,
        endMin: 765,
        weekdays: [1],
        fromKey: "2026-07-01",
        untilKey: "not-a-date",
      },
    ]);
    expect(b.fromKey).toBe("2026-07-01");
    expect(b.untilKey).toBeUndefined();
  });

  it("drops a stray mealKind field (meals-3: the field was removed — nothing read it)", () => {
    const [b] = normalizeGuides([
      { id: "g2", label: "X", startMin: 720, endMin: 765, weekdays: [1], mealKind: "lunch" },
    ]);
    expect((b as unknown as Record<string, unknown>).mealKind).toBeUndefined();
  });
});

describe("guideBandsForRange", () => {
  it("emits one hit per matching weekday inside the range, in day-then-band order", () => {
    // 2026-07-06 (Mon) .. 2026-07-13 (Mon exclusive) = Mon..Sun.
    const hits = guideBandsForRange([band()], "2026-07-06", "2026-07-13");
    // Weekdays 1-5 -> Mon,Tue,Wed,Thu,Fri = 5 hits (Sat/Sun excluded).
    expect(hits.map((h) => h.date)).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
    ]);
  });

  it("honors from/until bounds inclusively", () => {
    const bounded = band({ fromKey: "2026-07-07", untilKey: "2026-07-09" });
    const hits = guideBandsForRange([bounded], "2026-07-06", "2026-07-13");
    expect(hits.map((h) => h.date)).toEqual(["2026-07-07", "2026-07-08", "2026-07-09"]);
  });

  it("orders same-day hits by the bands' stored order", () => {
    const morning = band({ id: "am", label: "AM", startMin: 9 * 60, endMin: 10 * 60, weekdays: [3] });
    const noon = band({ id: "pm", label: "Noon", weekdays: [3] });
    const hits = guideBandsForRange([morning, noon], "2026-07-08", "2026-07-09");
    expect(hits.map((h) => h.band.id)).toEqual(["am", "pm"]);
  });

  it("returns nothing for an empty or inverted range", () => {
    expect(guideBandsForRange([band()], "2026-07-08", "2026-07-08")).toEqual([]);
    expect(guideBandsForRange([band()], "2026-07-10", "2026-07-08")).toEqual([]);
    expect(guideBandsForRange([band()], "bad", "2026-07-08")).toEqual([]);
  });
});
