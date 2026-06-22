import { describe, it, expect } from "vitest";
import { normalizeCalendarEvent, type CalendarEvent } from "./types";
import {
  MAX_SERIES_OCCURRENCES,
  buildSeriesEvents,
  eventsInSeries,
  normalizeRecurrence,
  planSeriesDelete,
  planSeriesEdit,
  recurrenceDates,
  rulesEqual,
  summarizeRecurrence,
  type RecurrenceRule,
  type SeriesTemplate,
} from "./recurrence";

const template: SeriesTemplate = {
  startMin: 540,
  endMin: 600,
  allDay: false,
  kind: "custom",
  title: "Morning meeting",
};

// Deterministic id generator for tests.
function counter() {
  let n = 0;
  return () => "id-" + ++n;
}

describe("recurrenceDates", () => {
  it("always includes the start date as the first occurrence", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1, until: "2026-06-21" };
    expect(recurrenceDates("2026-06-21", rule)[0]).toBe("2026-06-21");
  });

  it("expands a daily rule inclusively through until", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1, until: "2026-06-24" };
    expect(recurrenceDates("2026-06-21", rule)).toEqual([
      "2026-06-21",
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
    ]);
  });

  it("honours a daily interval > 1", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 2, until: "2026-06-27" };
    expect(recurrenceDates("2026-06-21", rule)).toEqual([
      "2026-06-21",
      "2026-06-23",
      "2026-06-25",
      "2026-06-27",
    ]);
  });

  it("returns just the start when until is on or before it", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1, until: "2026-06-20" };
    expect(recurrenceDates("2026-06-21", rule)).toEqual(["2026-06-21"]);
  });

  it("weekly with no weekdays repeats on the start's own weekday", () => {
    // 2026-06-21 is a Sunday.
    const rule: RecurrenceRule = { freq: "weekly", interval: 1, until: "2026-07-12" };
    expect(recurrenceDates("2026-06-21", rule)).toEqual([
      "2026-06-21",
      "2026-06-28",
      "2026-07-05",
      "2026-07-12",
    ]);
  });

  it("weekly on selected weekdays emits each within the horizon", () => {
    // Start Mon 2026-06-22; Mon/Wed/Fri.
    const rule: RecurrenceRule = {
      freq: "weekly",
      interval: 1,
      weekdays: [1, 3, 5],
      until: "2026-07-03",
    };
    expect(recurrenceDates("2026-06-22", rule)).toEqual([
      "2026-06-22", // Mon
      "2026-06-24", // Wed
      "2026-06-26", // Fri
      "2026-06-29", // Mon
      "2026-07-01", // Wed
      "2026-07-03", // Fri
    ]);
  });

  it("weekly interval 2 skips the in-between week", () => {
    // Start Mon 2026-06-22, every 2 weeks on Mon.
    const rule: RecurrenceRule = {
      freq: "weekly",
      interval: 2,
      weekdays: [1],
      until: "2026-07-21",
    };
    expect(recurrenceDates("2026-06-22", rule)).toEqual(["2026-06-22", "2026-07-06", "2026-07-20"]);
  });

  it("keeps the start even when its weekday isn't in the selected set", () => {
    // Start Sun 2026-06-21 but only Mon selected — start stays, then Mondays.
    const rule: RecurrenceRule = {
      freq: "weekly",
      interval: 1,
      weekdays: [1],
      until: "2026-07-06",
    };
    expect(recurrenceDates("2026-06-21", rule)).toEqual([
      "2026-06-21",
      "2026-06-22",
      "2026-06-29",
      "2026-07-06",
    ]);
  });

  it("caps a far-future daily rule at MAX_SERIES_OCCURRENCES", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1, until: "2099-01-01" };
    expect(recurrenceDates("2026-06-21", rule).length).toBe(MAX_SERIES_OCCURRENCES);
  });
});

describe("normalizeRecurrence", () => {
  it("accepts a valid daily rule", () => {
    expect(normalizeRecurrence({ freq: "daily", interval: 1, until: "2026-07-01" })).toEqual({
      freq: "daily",
      interval: 1,
      until: "2026-07-01",
    });
  });

  it("cleans, sorts and de-dupes weekdays", () => {
    const rule = normalizeRecurrence({
      freq: "weekly",
      interval: 1,
      until: "2026-07-01",
      weekdays: [5, 1, 1, 9, 3],
    });
    expect(rule?.weekdays).toEqual([1, 3, 5]);
  });

  it("defaults a bad interval to 1 and clamps a huge one", () => {
    expect(normalizeRecurrence({ freq: "daily", interval: 0, until: "2026-07-01" })?.interval).toBe(1);
    expect(normalizeRecurrence({ freq: "daily", interval: 999, until: "2026-07-01" })?.interval).toBe(52);
  });

  it("rejects malformed input", () => {
    expect(normalizeRecurrence(null)).toBeNull();
    expect(normalizeRecurrence({ freq: "yearly", until: "2026-07-01" })).toBeNull();
    expect(normalizeRecurrence({ freq: "daily", until: "not-a-date" })).toBeNull();
  });
});

describe("rulesEqual", () => {
  it("compares freq, interval, until and weekdays", () => {
    const a: RecurrenceRule = { freq: "weekly", interval: 1, weekdays: [1, 3], until: "2026-07-01" };
    expect(rulesEqual(a, { ...a })).toBe(true);
    expect(rulesEqual(a, { ...a, until: "2026-07-02" })).toBe(false);
    expect(rulesEqual(a, { ...a, weekdays: [1, 4] })).toBe(false);
    expect(rulesEqual(a, undefined)).toBe(false);
  });
});

describe("buildSeriesEvents", () => {
  it("reuses the anchor id and mints fresh ids for the rest", () => {
    const dates = ["2026-06-21", "2026-06-22", "2026-06-23"];
    const rule: RecurrenceRule = { freq: "daily", interval: 1, until: "2026-06-23" };
    const events = buildSeriesEvents(template, dates, "series-1", rule, counter(), "2026-06-21", "anchor");
    expect(events.map((e) => e.id)).toEqual(["anchor", "id-1", "id-2"]);
    expect(events.every((e) => e.seriesId === "series-1")).toBe(true);
    expect(events.every((e) => e.recurrence === rule)).toBe(true);
    expect(events[0]).toMatchObject({ startMin: 540, endMin: 600, title: "Morning meeting" });
  });

  it("zeroes the times and flags allDay for an all-day template", () => {
    const allDay: SeriesTemplate = { ...template, allDay: true };
    const [event] = buildSeriesEvents(allDay, ["2026-06-21"], "s", { freq: "daily", interval: 1, until: "2026-06-21" }, counter(), "2026-06-21", "a");
    expect(event).toMatchObject({ allDay: true, startMin: 0, endMin: 0 });
  });
});

function makeSeries(): CalendarEvent[] {
  const rule: RecurrenceRule = { freq: "daily", interval: 1, until: "2026-06-24" };
  return buildSeriesEvents(template, ["2026-06-21", "2026-06-22", "2026-06-23", "2026-06-24"], "series-1", rule, counter(), "2026-06-21", "a0").map(
    (e, i) => ({ ...e, id: "a" + i })
  );
}

describe("eventsInSeries", () => {
  it("collects and date-orders a series, ignoring others", () => {
    const series = makeSeries();
    const map: Record<string, CalendarEvent> = {};
    for (const e of series) map[e.id] = e;
    map["loose"] = { ...template, id: "loose", date: "2026-06-22", updatedAt: 0 } as CalendarEvent;
    const out = eventsInSeries(map, "series-1");
    expect(out.map((e) => e.id)).toEqual(["a0", "a1", "a2", "a3"]);
  });
});

describe("planSeriesDelete", () => {
  const series = makeSeries();
  const target = series[1]; // 2026-06-22

  it('"this" removes only the target', () => {
    expect(planSeriesDelete(series, target, "this")).toEqual(["a1"]);
  });

  it('"following" removes the target and every later occurrence', () => {
    expect(planSeriesDelete(series, target, "following")).toEqual(["a1", "a2", "a3"]);
  });

  it('"all" removes the whole series', () => {
    expect(planSeriesDelete(series, target, "all")).toEqual(["a0", "a1", "a2", "a3"]);
  });
});

describe("planSeriesEdit", () => {
  const rule: RecurrenceRule = { freq: "daily", interval: 1, until: "2026-06-24" };

  it('"this" rewrites one occurrence in place, keeping its id and series', () => {
    const series = makeSeries();
    const target = series[1];
    const moved: SeriesTemplate = { ...template, startMin: 600, endMin: 660 };
    const plan = planSeriesEdit(series, target, moved, target.date, rule, "this", counter());
    expect(plan.removes).toEqual([]);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({ id: "a1", seriesId: "series-1", startMin: 600, endMin: 660 });
  });

  it('"following" regenerates from the target forward, leaving earlier occurrences', () => {
    const series = makeSeries();
    const target = series[1]; // 2026-06-22
    const moved: SeriesTemplate = { ...template, startMin: 600, endMin: 660 };
    const plan = planSeriesEdit(series, target, moved, target.date, rule, "following", counter());
    // Removes the target + later (a1,a2,a3); keeps a0 untouched.
    expect(plan.removes).toEqual(["a1", "a2", "a3"]);
    // Regenerated occurrences start at the target date, anchor id preserved.
    expect(plan.upserts.map((e) => e.date)).toEqual(["2026-06-22", "2026-06-23", "2026-06-24"]);
    expect(plan.upserts[0].id).toBe("a1");
    expect(plan.upserts.every((e) => e.startMin === 600)).toBe(true);
  });

  it('"all" regenerates the whole series from its original start with new details', () => {
    const series = makeSeries();
    const target = series[2]; // edit the 3rd occurrence
    const moved: SeriesTemplate = { ...template, title: "Renamed", startMin: 480, endMin: 540 };
    const plan = planSeriesEdit(series, target, moved, target.date, rule, "all", counter());
    expect(plan.removes).toEqual(["a0", "a1", "a2", "a3"]);
    expect(plan.upserts.map((e) => e.date)).toEqual([
      "2026-06-21",
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
    ]);
    expect(plan.upserts[0].id).toBe("a0"); // earliest anchor id preserved
    expect(plan.upserts.every((e) => e.title === "Renamed" && e.startMin === 480)).toBe(true);
  });

  it('"this" with a cleared rule detaches the occurrence into a standalone event', () => {
    const series = makeSeries();
    const target = series[1];
    const plan = planSeriesEdit(series, target, template, target.date, undefined, "this", counter());
    expect(plan.removes).toEqual([]);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].id).toBe("a1");
    expect(plan.upserts[0].seriesId).toBeUndefined();
    expect(plan.upserts[0].recurrence).toBeUndefined();
  });

  it('"following" with a cleared rule keeps this one and drops the rest', () => {
    const series = makeSeries();
    const target = series[1];
    const plan = planSeriesEdit(series, target, template, target.date, undefined, "following", counter());
    expect(plan.removes).toEqual(["a1", "a2", "a3"]);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({ id: "a1", date: "2026-06-22" });
    expect(plan.upserts[0].seriesId).toBeUndefined();
  });

  it("regenerates following with a changed rule (weekly), shrinking the set", () => {
    const series = makeSeries(); // daily Jun 21–24
    const target = series[0]; // 2026-06-21 Sunday
    const weekly: RecurrenceRule = { freq: "weekly", interval: 1, weekdays: [0], until: "2026-07-05" };
    const plan = planSeriesEdit(series, target, template, target.date, weekly, "following", counter());
    expect(plan.upserts.map((e) => e.date)).toEqual(["2026-06-21", "2026-06-28", "2026-07-05"]);
    expect(plan.upserts.every((e) => e.recurrence === weekly)).toBe(true);
  });
});

// The whole feature hinges on the client normalizer preserving the series
// fields — it rebuilds a clean object on every read and optimistic write.
describe("normalizeCalendarEvent series round-trip", () => {
  const base = {
    id: "1",
    date: "2026-06-21",
    startMin: 540,
    endMin: 600,
    kind: "custom",
    title: "Meeting",
    updatedAt: 1,
  };

  it("keeps seriesId + a valid recurrence rule", () => {
    const event = normalizeCalendarEvent({
      ...base,
      seriesId: "series-1",
      recurrence: { freq: "daily", interval: 1, until: "2026-06-30" },
    });
    expect(event?.seriesId).toBe("series-1");
    expect(event?.recurrence).toEqual({ freq: "daily", interval: 1, until: "2026-06-30" });
  });

  it("drops series fields when the rule is malformed", () => {
    const event = normalizeCalendarEvent({ ...base, seriesId: "series-1", recurrence: { freq: "yearly" } });
    expect(event?.seriesId).toBeUndefined();
    expect(event?.recurrence).toBeUndefined();
  });

  it("drops recurrence when seriesId is missing (an orphan rule is meaningless)", () => {
    const event = normalizeCalendarEvent({ ...base, recurrence: { freq: "daily", interval: 1, until: "2026-06-30" } });
    expect(event?.recurrence).toBeUndefined();
  });
});

describe("summarizeRecurrence", () => {
  it("summarizes daily", () => {
    expect(summarizeRecurrence({ freq: "daily", interval: 1, until: "2026-07-31" })).toMatch(
      /^Repeats daily until /
    );
  });

  it("summarizes weekly with weekdays", () => {
    const out = summarizeRecurrence({ freq: "weekly", interval: 1, weekdays: [1, 3, 5], until: "2026-07-31" });
    expect(out).toContain("weekly on Mon, Wed, Fri");
  });

  it("summarizes an interval", () => {
    expect(summarizeRecurrence({ freq: "daily", interval: 3, until: "2026-07-31" })).toContain(
      "every 3 days"
    );
  });
});
