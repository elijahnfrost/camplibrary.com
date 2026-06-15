import { describe, expect, it } from "vitest";
import { normalizeCamps, type Camp } from "./camps";
import { normalizeCalendarEvent } from "./calendar/types";

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
    expect(result[0]).toEqual({ id: "c1", name: "Summer Day Camp", createdAt: 100 });
    // Missing createdAt defaults to 0.
    expect(result[1].createdAt).toBe(0);
  });

  it("trims names and dedupes by id", () => {
    const result = normalizeCamps(
      [
        { id: "c1", name: "  Summer  " },
        { id: "c1", name: "Duplicate" },
      ],
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Summer");
  });

  it("falls back when the value is not an array", () => {
    const fallback: Camp[] = [{ id: "f", name: "Fallback", createdAt: 0 }];
    expect(normalizeCamps("nope", fallback)).toBe(fallback);
    expect(normalizeCamps(null, fallback)).toBe(fallback);
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
