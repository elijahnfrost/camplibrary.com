import { describe, it, expect } from "vitest";
import { normalizeCalendarEvent, type CalendarEvent } from "./types";
import {
  MAX_SERIES_OCCURRENCES,
  buildSeriesEvents,
  eventsInSeries,
  normalizeRecurrence,
  planSeriesDelete,
  planSeriesEdit,
  planSeriesSkip,
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

  it("monthly day-of-month lands on the same day each month", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1, monthDay: 15, until: "2026-09-15" };
    expect(recurrenceDates("2026-06-15", rule)).toEqual([
      "2026-06-15",
      "2026-07-15",
      "2026-08-15",
      "2026-09-15",
    ]);
  });

  it("monthly day-of-month skips months without that day (the 31st)", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1, monthDay: 31, until: "2026-05-31" };
    // Jan/Mar/May have a 31st; Feb/Apr do not.
    expect(recurrenceDates("2026-01-31", rule)).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("monthly nth-weekday lands on e.g. the 3rd Tuesday", () => {
    // 2026-06-16 is the 3rd Tuesday of June 2026.
    const rule: RecurrenceRule = {
      freq: "monthly",
      interval: 1,
      nthWeekday: { week: 3, weekday: 2 },
      until: "2026-08-31",
    };
    expect(recurrenceDates("2026-06-16", rule)).toEqual([
      "2026-06-16",
      "2026-07-21", // 3rd Tue of July
      "2026-08-18", // 3rd Tue of Aug
    ]);
  });

  it("monthly last-weekday uses week -1", () => {
    // last Friday of each month
    const rule: RecurrenceRule = {
      freq: "monthly",
      interval: 1,
      nthWeekday: { week: -1, weekday: 5 },
      until: "2026-08-31",
    };
    expect(recurrenceDates("2026-06-26", rule)).toEqual([
      "2026-06-26", // last Fri June
      "2026-07-31", // last Fri July
      "2026-08-28", // last Fri Aug
    ]);
  });

  it("yearly repeats on the anniversary", () => {
    const rule: RecurrenceRule = { freq: "yearly", interval: 1, until: "2029-07-04" };
    expect(recurrenceDates("2026-07-04", rule)).toEqual([
      "2026-07-04",
      "2027-07-04",
      "2028-07-04",
      "2029-07-04",
    ]);
  });

  it("subtracts exdates from the placed occurrences", () => {
    const rule: RecurrenceRule = {
      freq: "daily",
      interval: 1,
      until: "2026-06-24",
      exdates: ["2026-06-22"],
    };
    expect(recurrenceDates("2026-06-21", rule)).toEqual(["2026-06-21", "2026-06-23", "2026-06-24"]);
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
    expect(normalizeRecurrence({ freq: "hourly", until: "2026-07-01" })).toBeNull();
    expect(normalizeRecurrence({ freq: "daily", until: "not-a-date" })).toBeNull();
  });

  it("accepts monthly with a day-of-month anchor", () => {
    expect(normalizeRecurrence({ freq: "monthly", interval: 1, monthDay: 15, until: "2026-12-31" })).toEqual({
      freq: "monthly",
      interval: 1,
      monthDay: 15,
      until: "2026-12-31",
    });
  });

  it("accepts monthly with an nth-weekday anchor, and it wins over monthDay", () => {
    const rule = normalizeRecurrence({
      freq: "monthly",
      interval: 1,
      monthDay: 15,
      nthWeekday: { week: 3, weekday: 2 },
      until: "2026-12-31",
    });
    expect(rule?.nthWeekday).toEqual({ week: 3, weekday: 2 });
    expect(rule?.monthDay).toBeUndefined();
  });

  it("accepts yearly and cleans/sorts/de-dupes exdates", () => {
    const rule = normalizeRecurrence({
      freq: "yearly",
      interval: 1,
      until: "2030-07-01",
      exdates: ["2027-07-01", "2027-07-01", "bad", "2026-07-01"],
    });
    expect(rule?.freq).toBe("yearly");
    expect(rule?.exdates).toEqual(["2026-07-01", "2027-07-01"]);
  });

  it("rejects an out-of-range nth-weekday and bad monthDay", () => {
    const rule = normalizeRecurrence({
      freq: "monthly",
      interval: 1,
      monthDay: 99,
      nthWeekday: { week: 9, weekday: 2 },
      until: "2026-12-31",
    });
    expect(rule?.nthWeekday).toBeUndefined();
    expect(rule?.monthDay).toBeUndefined();
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

  it('carries "pinned" through an "all" regeneration so a pinned series stays pinned', () => {
    const series = makeSeries();
    const target = series[2];
    // The edited draft's template carries pinned (buildTemplate threads it off the
    // edited row); every regenerated occurrence must inherit it.
    const pinnedTemplate: SeriesTemplate = { ...template, pinned: true };
    const plan = planSeriesEdit(series, target, pinnedTemplate, target.date, rule, "all", counter());
    expect(plan.upserts).toHaveLength(4);
    expect(plan.upserts.every((e) => e.pinned === true)).toBe(true);
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

  it("carries an existing exdate forward so a regenerated 'all' edit doesn't resurrect it", () => {
    // A daily series with 2026-06-22 already skipped (exdate recorded on the rule).
    const rule: RecurrenceRule = {
      freq: "daily",
      interval: 1,
      until: "2026-06-24",
      exdates: ["2026-06-22"],
    };
    const series = buildSeriesEvents(
      template,
      ["2026-06-21", "2026-06-23", "2026-06-24"],
      "series-1",
      rule,
      counter(),
      "2026-06-21",
      "a0"
    ).map((e, i) => ({ ...e, id: "a" + i }));
    const target = series[0];
    const moved: SeriesTemplate = { ...template, startMin: 600, endMin: 660 };
    // The editor draft rule has NO exdates — the skip must survive regardless.
    const draftRule: RecurrenceRule = { freq: "daily", interval: 1, until: "2026-06-24" };
    const plan = planSeriesEdit(series, target, moved, target.date, draftRule, "all", counter());
    // The skipped day stays skipped after a blind "all" regeneration.
    expect(plan.upserts.map((e) => e.date)).toEqual(["2026-06-21", "2026-06-23", "2026-06-24"]);
    expect(plan.upserts.every((e) => e.recurrence?.exdates?.includes("2026-06-22"))).toBe(true);
  });
});

describe("planSeriesSkip", () => {
  it("removes the occurrence and records its date as an exdate on the survivors", () => {
    const series = makeSeries(); // daily Jun 21–24, ids a0..a3
    const target = series[1]; // 2026-06-22
    const plan = planSeriesSkip(series, target);
    expect(plan.removes).toEqual(["a1"]);
    expect(plan.upserts.map((e) => e.id)).toEqual(["a0", "a2", "a3"]);
    expect(plan.upserts.every((e) => e.recurrence?.exdates?.includes("2026-06-22"))).toBe(true);
  });

  it("falls back to a plain delete for a non-series occurrence", () => {
    const loose: CalendarEvent = { ...template, id: "loose", date: "2026-06-22", updatedAt: 0 } as CalendarEvent;
    const plan = planSeriesSkip([loose], loose);
    expect(plan).toEqual({ upserts: [], removes: ["loose"] });
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

describe("normalizeCalendarEvent locations", () => {
  const base = {
    id: "1",
    date: "2026-06-21",
    startMin: 540,
    endMin: 600,
    kind: "custom",
    title: "Meeting",
    updatedAt: 1,
  };

  it("keeps a multi-value locations array", () => {
    const event = normalizeCalendarEvent({ ...base, locations: ["Gym", "Kitchen"] });
    expect(event?.locations).toEqual(["Gym", "Kitchen"]);
  });

  it("trims entries and drops blanks", () => {
    const event = normalizeCalendarEvent({ ...base, locations: ["  Gym  ", "", "   "] });
    expect(event?.locations).toEqual(["Gym"]);
  });

  it("dedupes case-insensitively, keeping the first casing", () => {
    const event = normalizeCalendarEvent({ ...base, locations: ["Gym", "gym", "Fields"] });
    expect(event?.locations).toEqual(["Gym", "Fields"]);
  });

  it("falls back to a legacy single location string", () => {
    const event = normalizeCalendarEvent({ ...base, location: "Playground" });
    expect(event?.locations).toEqual(["Playground"]);
  });

  it("leaves locations unset when none resolve", () => {
    const event = normalizeCalendarEvent({ ...base, locations: ["", 7, null] });
    expect(event?.locations).toBeUndefined();
  });

  it("bounds the list against an unbounded payload", () => {
    const many = Array.from({ length: 50 }, (_, i) => `Place ${i}`);
    const event = normalizeCalendarEvent({ ...base, locations: many });
    expect(event?.locations?.length).toBe(12);
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
