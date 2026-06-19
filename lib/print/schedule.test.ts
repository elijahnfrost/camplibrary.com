import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { MAX_PRINT_DAYS, buildScheduleDays, enumerateDates, selectEvents, sortDayEvents } from "./schedule";

function ev(partial: Partial<CalendarEvent> & { id: string; date: string }): CalendarEvent {
  return {
    startMin: 540,
    endMin: 600,
    kind: "custom",
    title: partial.id,
    updatedAt: 0,
    ...partial,
  };
}

describe("enumerateDates", () => {
  it("is inclusive of both endpoints in order", () => {
    expect(enumerateDates("2026-01-16", "2026-01-18")).toEqual([
      "2026-01-16",
      "2026-01-17",
      "2026-01-18",
    ]);
  });

  it("handles a single-day range", () => {
    expect(enumerateDates("2026-01-16", "2026-01-16")).toEqual(["2026-01-16"]);
  });

  it("auto-swaps a reversed range", () => {
    expect(enumerateDates("2026-01-18", "2026-01-16")).toEqual([
      "2026-01-16",
      "2026-01-17",
      "2026-01-18",
    ]);
  });

  it("crosses a month boundary correctly", () => {
    expect(enumerateDates("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });

  it("caps an absurd range at MAX_PRINT_DAYS", () => {
    const days = enumerateDates("2026-01-01", "2099-01-01");
    expect(days).toHaveLength(MAX_PRINT_DAYS);
    expect(days[0]).toBe("2026-01-01");
  });
});

describe("selectEvents", () => {
  const events: Record<string, CalendarEvent> = {
    a: ev({ id: "a", date: "2026-01-16", campId: "c1" }),
    b: ev({ id: "b", date: "2026-01-17" }), // unscoped
    c: ev({ id: "c", date: "2026-01-17", campId: "c2" }),
    d: ev({ id: "d", date: "2026-01-20" }), // out of range
    e: ev({ id: "e", date: "2026-01-16", allDay: true, startMin: 0, endMin: 0 }),
    f: ev({ id: "f", date: "2026-01-16", campId: "ghost" }), // camp deleted
  };
  const campIds = new Set(["c1", "c2"]);

  it("keeps only events inside the range", () => {
    const ids = selectEvents(events, {
      start: "2026-01-16",
      end: "2026-01-18",
      campId: null,
      campIds,
      includeAllDay: true,
    }).map((e) => e.id);
    expect(ids).not.toContain("d");
    expect(ids).toEqual(expect.arrayContaining(["a", "b", "c", "e", "f"]));
  });

  it("filters to a specific camp, excluding other camps", () => {
    const ids = selectEvents(events, {
      start: "2026-01-16",
      end: "2026-01-18",
      campId: "c1",
      campIds,
      includeAllDay: true,
    }).map((e) => e.id);
    expect(ids).toContain("a");
    expect(ids).not.toContain("c"); // belongs to c2
    expect(ids).not.toContain("b"); // unscoped is not c1
  });

  it("drops all-day events when includeAllDay is false", () => {
    const ids = selectEvents(events, {
      start: "2026-01-16",
      end: "2026-01-18",
      campId: null,
      campIds,
      includeAllDay: false,
    }).map((e) => e.id);
    expect(ids).not.toContain("e");
  });
});

describe("sortDayEvents", () => {
  it("orders all-day first, then by start time, stable on title", () => {
    const out = sortDayEvents([
      ev({ id: "noon", date: "2026-01-16", startMin: 720, endMin: 780, title: "Noon" }),
      ev({ id: "allday", date: "2026-01-16", allDay: true, startMin: 0, endMin: 0, title: "Field trip" }),
      ev({ id: "morning", date: "2026-01-16", startMin: 540, endMin: 600, title: "Morning" }),
      ev({ id: "tieB", date: "2026-01-16", startMin: 540, endMin: 600, title: "B-event" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["allday", "tieB", "morning", "noon"]);
  });
});

describe("buildScheduleDays", () => {
  const selected = [
    ev({ id: "a", date: "2026-01-16", startMin: 600, endMin: 660 }),
    ev({ id: "b", date: "2026-01-18", startMin: 540, endMin: 600 }),
  ];

  it("drops interior empty days but keeps range edges", () => {
    const days = buildScheduleDays(selected, "2026-01-16", "2026-01-18", false);
    // 17th is empty + interior → dropped; 16th & 18th are edges → kept.
    expect(days.map((d) => d.date)).toEqual(["2026-01-16", "2026-01-18"]);
  });

  it("keeps every day when includeEmptyDays is true", () => {
    const days = buildScheduleDays(selected, "2026-01-16", "2026-01-18", true);
    expect(days.map((d) => d.date)).toEqual(["2026-01-16", "2026-01-17", "2026-01-18"]);
    expect(days[1].events).toEqual([]);
  });
});
