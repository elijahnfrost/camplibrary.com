// Recurring calendar events, modelled as MATERIALIZED occurrences rather than a
// stored rule expanded on read. Every consumer in the app — the FullCalendar
// adapter, drag/resize, the .ics feed, Print, run lists, themes, camp filtering
// — already operates on concrete CalendarEvent rows, and the store is per-event
// last-write-wins with an outbox keyed by id. So a "series" is just a set of
// real events that share a `seriesId` and each carry the same `recurrence` rule
// (denormalised so any one occurrence can describe and edit the whole series).
// Camp seasons are bounded, so an inclusive `until` horizon is the natural fit;
// this file is the one place that knows how a rule expands into those dates.

import type { CalendarEvent, CalendarEventKind, DateKey } from "./types";
import { addDays, daySpan, fromDateKey, toDateKey } from "./dates";

// A local DateKey guard. types.ts imports normalizeRecurrence from here (to keep
// the series fields through normalization), so this module avoids a value import
// back from types.ts — it only depends on it for types (erased at compile).
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function isDateKey(value: unknown): value is DateKey {
  return typeof value === "string" && DATE_KEY_PATTERN.test(value);
}

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

// Monthly/yearly "nth weekday" anchor — e.g. the 3rd Tuesday, or the last
// Friday. `week` is 1..4 (first..fourth) or -1 (last); `weekday` is 0 (Sun)..6.
export interface NthWeekday {
  week: number;
  weekday: number;
}

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** Every N days / weeks / months / years. Always ≥ 1. */
  interval: number;
  /** Weekly only: which weekdays land an occurrence (0 = Sunday … 6 = Saturday),
   *  sorted, de-duped, non-empty. Omitted for daily. */
  weekdays?: number[];
  /** Monthly/yearly day-of-month anchor (1..31). When set, the series lands on
   *  that day of each qualifying month, skipping months without it (e.g. the
   *  31st skips February). Mutually exclusive with `nthWeekday`. */
  monthDay?: number;
  /** Monthly/yearly nth-weekday anchor (e.g. "3rd Tuesday"). Mutually exclusive
   *  with `monthDay`. */
  nthWeekday?: NthWeekday;
  /** Inclusive last date the series may place an occurrence on. */
  until: DateKey;
  /** Single-day skips (EXDATE): occurrence dates the series must NOT place, even
   *  when a later "all"/"following" edit regenerates from the rule. Sorted,
   *  de-duped. Survives series edits so a skipped day isn't resurrected. */
  exdates?: DateKey[];
}

// A series never expands past this many occurrences — a hard backstop against a
// far-future `until` (a daily year is 366) generating an unbounded write storm.
export const MAX_SERIES_OCCURRENCES = 366;
// The day-by-day scan also can't run forever even if it places nothing.
const MAX_SCAN_DAYS = 800;
// Month/year stepping is unit-based (not day-by-day), so it needs its own cap to
// stay bounded independently of MAX_SCAN_DAYS.
const MAX_UNIT_STEPS = 1200;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDINAL_LABELS: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
};

function dow(key: DateKey): number {
  return fromDateKey(key).getDay();
}

// Sunday-anchored start of the week containing `key`, so the weekly interval can
// count whole weeks between two dates regardless of which weekday each falls on.
function weekAnchor(key: DateKey): DateKey {
  return addDays(key, -dow(key));
}

// 1-based [year, month(1-12), day] of a DateKey.
function ymd(key: DateKey): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}

// Days in a given 1-based month (day 0 of the next month).
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function makeKey(year: number, month: number, day: number): DateKey {
  return toDateKey(new Date(year, month - 1, day));
}

// The DateKey of the nth `weekday` of a 1-based month, or null when that nth
// weekday doesn't exist (e.g. a 5th Tuesday in a short month). `week` is 1..4 or
// -1 (last).
function nthWeekdayOfMonth(year: number, month: number, week: number, weekday: number): DateKey | null {
  const dim = daysInMonth(year, month);
  if (week === -1) {
    for (let d = dim; d >= 1; d--) {
      if (new Date(year, month - 1, d).getDay() === weekday) return makeKey(year, month, d);
    }
    return null;
  }
  let count = 0;
  for (let d = 1; d <= dim; d++) {
    if (new Date(year, month - 1, d).getDay() === weekday) {
      count += 1;
      if (count === week) return makeKey(year, month, d);
    }
  }
  return null;
}

function cleanWeekdays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const set = new Set<number>();
  for (const value of raw) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) {
      set.add(value);
    }
  }
  if (!set.size) return null;
  return [...set].sort((a, b) => a - b);
}

function cleanNthWeekday(raw: unknown): NthWeekday | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const week = value.week;
  const weekday = value.weekday;
  const validWeek =
    typeof week === "number" && Number.isInteger(week) && (week === -1 || (week >= 1 && week <= 4));
  const validWeekday =
    typeof weekday === "number" && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6;
  if (!validWeek || !validWeekday) return null;
  return { week, weekday };
}

function cleanExdates(raw: unknown): DateKey[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const set = new Set<DateKey>();
  for (const value of raw) {
    if (isDateKey(value)) set.add(value);
  }
  if (!set.size) return undefined;
  return [...set].sort();
}

// Parse an untrusted value (localStorage cache or API payload) into a
// RecurrenceRule, returning null for anything malformed so a bad payload just
// degrades the event to a plain one rather than throwing.
export function normalizeRecurrence(raw: unknown): RecurrenceRule | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    value.freq !== "daily" &&
    value.freq !== "weekly" &&
    value.freq !== "monthly" &&
    value.freq !== "yearly"
  ) {
    return null;
  }
  if (!isDateKey(value.until)) return null;
  const interval =
    typeof value.interval === "number" && Number.isInteger(value.interval) && value.interval >= 1
      ? Math.min(value.interval, 52)
      : 1;
  const rule: RecurrenceRule = { freq: value.freq, interval, until: value.until };

  if (value.freq === "weekly") {
    const weekdays = cleanWeekdays(value.weekdays);
    if (weekdays) rule.weekdays = weekdays;
  } else if (value.freq === "monthly" || value.freq === "yearly") {
    // Mutually exclusive anchors: nth-weekday wins when both are present. With
    // neither, the expander derives a day-of-month anchor from the start date.
    const nth = cleanNthWeekday(value.nthWeekday);
    if (nth) {
      rule.nthWeekday = nth;
    } else if (
      typeof value.monthDay === "number" &&
      Number.isInteger(value.monthDay) &&
      value.monthDay >= 1 &&
      value.monthDay <= 31
    ) {
      rule.monthDay = value.monthDay;
    }
  }

  const exdates = cleanExdates(value.exdates);
  if (exdates) rule.exdates = exdates;

  return rule;
}

function exdatesEqual(a: DateKey[] | undefined, b: DateKey[] | undefined): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  return aa.length === bb.length && aa.every((d, i) => d === bb[i]);
}

export function rulesEqual(a: RecurrenceRule | undefined, b: RecurrenceRule | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.freq !== b.freq || a.interval !== b.interval || a.until !== b.until) return false;
  const aw = a.weekdays ?? [];
  const bw = b.weekdays ?? [];
  if (aw.length !== bw.length || !aw.every((d, i) => d === bw[i])) return false;
  if ((a.monthDay ?? null) !== (b.monthDay ?? null)) return false;
  const an = a.nthWeekday;
  const bn = b.nthWeekday;
  if (Boolean(an) !== Boolean(bn)) return false;
  if (an && bn && (an.week !== bn.week || an.weekday !== bn.weekday)) return false;
  return exdatesEqual(a.exdates, b.exdates);
}

// The raw occurrence dates a rule places, BEFORE exdates are subtracted. The
// start date is ALWAYS the first occurrence — the event you placed never moves
// out from under you, even if its day doesn't satisfy the rule's anchor (this
// mirrors RFC 5545's DTSTART-is-always-included rule, and is relied on across
// the app: drag/resize, "this" edits, the popover's "this occurrence").
function rawRecurrenceDates(startDate: DateKey, rule: RecurrenceRule): DateKey[] {
  const out: DateKey[] = [startDate];
  if (rule.until <= startDate) return out;
  const interval = Math.max(1, rule.interval);

  if (rule.freq === "daily" || rule.freq === "weekly") {
    // A simple day-by-day scan keeps the weekly / interval / weekday logic in one
    // obvious place; it's bounded by both the date horizon and the scan caps.
    const startWeek = weekAnchor(startDate);
    const weekdays =
      rule.freq === "weekly" ? (rule.weekdays?.length ? rule.weekdays : [dow(startDate)]) : null;
    let cursor = addDays(startDate, 1);
    let scanned = 0;
    while (cursor <= rule.until && out.length < MAX_SERIES_OCCURRENCES && scanned < MAX_SCAN_DAYS) {
      let include = false;
      if (rule.freq === "daily") {
        include = daySpan(startDate, cursor) % interval === 0;
      } else if (weekdays!.includes(dow(cursor))) {
        const weekDiff = Math.round(daySpan(startWeek, weekAnchor(cursor)) / 7);
        include = weekDiff % interval === 0;
      }
      if (include) out.push(cursor);
      cursor = addDays(cursor, 1);
      scanned += 1;
    }
    return out;
  }

  // Monthly / yearly: step by the unit (not day-by-day), so a long yearly
  // horizon isn't truncated by the day-scan cap. Each qualifying period resolves
  // to one candidate date (day-of-month or nth-weekday); periods where it can't
  // exist (e.g. the 31st in February, a 5th Tuesday) are simply skipped.
  const [startYear, startMonth, startDay] = ymd(startDate);
  const nth = rule.nthWeekday ?? null;
  const monthDay = nth ? null : rule.monthDay ?? startDay;

  const resolveInMonth = (year: number, month: number): DateKey | null => {
    if (nth) return nthWeekdayOfMonth(year, month, nth.week, nth.weekday);
    if (monthDay! > daysInMonth(year, month)) return null;
    return makeKey(year, month, monthDay!);
  };

  let steps = 0;
  if (rule.freq === "monthly") {
    let monthIndex = startYear * 12 + (startMonth - 1) + interval; // skip the start's own month
    while (out.length < MAX_SERIES_OCCURRENCES && steps < MAX_UNIT_STEPS) {
      const year = Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const candidate = resolveInMonth(year, month);
      if (candidate && candidate > rule.until) break;
      if (candidate && candidate > startDate) out.push(candidate);
      // Even when this month yields no candidate (skipped), advance past `until`
      // eventually via the year guard below.
      if (year > startYear + 200) break;
      monthIndex += interval;
      steps += 1;
    }
  } else {
    // yearly — same month as the start, advancing by `interval` years.
    let year = startYear + interval;
    while (out.length < MAX_SERIES_OCCURRENCES && steps < MAX_UNIT_STEPS) {
      const candidate = resolveInMonth(year, startMonth);
      if (candidate && candidate > rule.until) break;
      if (candidate && candidate > startDate) out.push(candidate);
      if (makeKey(year, startMonth, 1) > rule.until) break;
      year += interval;
      steps += 1;
    }
  }
  return out;
}

// The ordered, unique occurrence dates a rule places from `startDate` through
// `rule.until` (inclusive), with the rule's exdates removed. The one place that
// knows how a rule expands into concrete dates.
export function recurrenceDates(startDate: DateKey, rule: RecurrenceRule): DateKey[] {
  if (!isDateKey(startDate)) return [];
  const raw = rawRecurrenceDates(startDate, rule);
  if (!rule.exdates?.length) return raw;
  const skip = new Set(rule.exdates);
  return raw.filter((date) => !skip.has(date));
}

// The event fields a series shares — everything except the per-occurrence id and
// date. Pulled off the editor draft (create / edit) and stamped onto each date.
export interface SeriesTemplate {
  startMin: number;
  endMin: number;
  allDay: boolean;
  kind: CalendarEventKind;
  title: string;
  activityId?: string;
  campId?: string;
  color?: string;
}

// One event from a template + date. With a seriesId/rule it's a series
// occurrence; with both omitted it's a detached standalone event (used when an
// occurrence is pulled out of its series, e.g. "stop repeating").
function occurrence(
  template: SeriesTemplate,
  date: DateKey,
  id: string,
  seriesId?: string,
  rule?: RecurrenceRule
): CalendarEvent {
  const event: CalendarEvent = {
    id,
    date,
    startMin: template.allDay ? 0 : template.startMin,
    endMin: template.allDay ? 0 : template.endMin,
    kind: template.kind,
    title: template.title,
    updatedAt: Date.now(),
  };
  if (seriesId && rule) {
    event.seriesId = seriesId;
    event.recurrence = rule;
  }
  if (template.activityId) event.activityId = template.activityId;
  if (template.campId) event.campId = template.campId;
  if (template.color) event.color = template.color;
  if (template.allDay) event.allDay = true;
  return event;
}

// Materialise a template into one CalendarEvent per date. The occurrence on
// `anchorDate` reuses `anchorId` so the event the user was already editing keeps
// its identity (and its row in the outbox); every other date gets a fresh id.
export function buildSeriesEvents(
  template: SeriesTemplate,
  dates: DateKey[],
  seriesId: string,
  rule: RecurrenceRule,
  newId: () => string,
  anchorDate: DateKey,
  anchorId: string
): CalendarEvent[] {
  return dates.map((date) =>
    occurrence(template, date, date === anchorDate ? anchorId : newId(), seriesId, rule)
  );
}

export type SeriesScope = "this" | "following" | "all";

// All events belonging to one series, ordered by date — the working set every
// scoped operation reasons over.
export function eventsInSeries(
  all: Record<string, CalendarEvent>,
  seriesId: string
): CalendarEvent[] {
  return Object.values(all)
    .filter((event) => event.seriesId === seriesId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Which occurrence ids a scoped delete removes.
export function planSeriesDelete(
  series: CalendarEvent[],
  target: CalendarEvent,
  scope: SeriesScope
): string[] {
  if (scope === "this") return [target.id];
  if (scope === "all") return series.map((event) => event.id);
  return series.filter((event) => event.date >= target.date).map((event) => event.id);
}

export interface SeriesEditPlan {
  upserts: CalendarEvent[];
  removes: string[];
}

// The union of exdates recorded on a series' occurrences (the rule is
// denormalised onto each row, so any one carries the skip history; we union to
// be robust to partial writes), restricted to a date range so a regenerated
// scope only inherits the skips that fall inside it.
function gatheredExdates(series: CalendarEvent[], from: DateKey, to: DateKey): DateKey[] {
  const set = new Set<DateKey>();
  for (const event of series) {
    for (const date of event.recurrence?.exdates ?? []) {
      if (date >= from && date <= to) set.add(date);
    }
  }
  return [...set].sort();
}

function withExdates(rule: RecurrenceRule, exdates: DateKey[]): RecurrenceRule {
  if (!exdates.length) {
    if (!rule.exdates?.length) return rule;
    const next = { ...rule };
    delete next.exdates;
    return next;
  }
  return { ...rule, exdates };
}

// A scoped edit. "This" rewrites the single occurrence in place (it stays in the
// series as an exception, or detaches to a standalone event when the rule is
// cleared). "Following" and "All" REGENERATE their portion of the series from
// the edited draft as the new template + rule — so whatever the user set in the
// editor (time, length, title, activity, repeat pattern) becomes the pattern
// going forward (following) or for the whole series (all), exactly the Google
// Calendar mental model. A cleared rule collapses the chosen scope down to the
// single edited occurrence. The anchor occurrence keeps a stable id. Skipped
// days (exdates) recorded on the series are carried forward into the regenerated
// rule so a later "all"/"following" edit doesn't resurrect them.
export function planSeriesEdit(
  series: CalendarEvent[],
  target: CalendarEvent,
  template: SeriesTemplate,
  draftDate: DateKey,
  rule: RecurrenceRule | undefined,
  scope: SeriesScope,
  newId: () => string
): SeriesEditPlan {
  const seriesId = target.seriesId as string;

  if (scope === "this") {
    // Keep it in the series unless the user cleared the repeat, which detaches
    // just this occurrence into a standalone event.
    const keep = rule ? { seriesId, rule: target.recurrence ?? rule } : { seriesId: undefined, rule: undefined };
    return {
      upserts: [occurrence(template, draftDate, target.id, keep.seriesId, keep.rule)],
      removes: [],
    };
  }

  const affected = scope === "all" ? series : series.filter((event) => event.date >= target.date);
  const removes = affected.map((event) => event.id);
  const anchorDate = scope === "all" ? (series[0]?.date ?? draftDate) : draftDate;
  const anchorId = affected.find((event) => event.date === anchorDate)?.id ?? target.id;

  // Repeat cleared for this scope → collapse to the single anchor occurrence as
  // a standalone event; earlier occurrences (for "following") are left alone.
  if (!rule) {
    return { upserts: [occurrence(template, anchorDate, anchorId)], removes };
  }

  // Carry skipped days that live inside the regenerated range forward, so the
  // regeneration honours them rather than blindly recreating every date.
  const carried = gatheredExdates(series, anchorDate, rule.until);
  const merged = new Set([...(rule.exdates ?? []), ...carried]);
  const ruleWithExdates = withExdates(rule, [...merged].filter((d) => d >= anchorDate).sort());

  // Regenerate from the earliest affected occurrence so "all" keeps the season's
  // original start while adopting the new time/details, and "following" starts at
  // the edited day.
  const dates = recurrenceDates(anchorDate, ruleWithExdates);
  const upserts = buildSeriesEvents(template, dates, seriesId, ruleWithExdates, newId, anchorDate, anchorId);
  return { upserts, removes };
}

// "Skip this day" — remove a single occurrence from a series AND record its date
// as an exdate on every surviving occurrence's rule, so a later "all"/"following"
// regeneration won't bring it back. Returns the surviving occurrences to re-upsert
// (with the updated rule) and the skipped occurrence id to remove. A no-op-safe
// helper: returns just the removal when the occurrence carries no rule.
export function planSeriesSkip(series: CalendarEvent[], target: CalendarEvent): SeriesEditPlan {
  if (!target.seriesId || !target.recurrence) {
    return { upserts: [], removes: [target.id] };
  }
  const survivors = series.filter((event) => event.id !== target.id);
  const upserts = survivors.map((event) => {
    const base = event.recurrence ?? target.recurrence!;
    const exdates = [...new Set([...(base.exdates ?? []), target.date])].sort();
    return { ...event, recurrence: withExdates(base, exdates), updatedAt: Date.now() };
  });
  return { upserts, removes: [target.id] };
}

// A short human summary for the popover / editor, e.g. "Repeats daily until
// Jul 31" or "Repeats weekly on Mon, Wed, Fri". Display-only.
export function summarizeRecurrence(rule: RecurrenceRule): string {
  const untilLabel = fromDateKey(rule.until).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const every = rule.interval > 1 ? rule.interval + " " : "";
  let cadence: string;
  if (rule.freq === "daily") {
    cadence = rule.interval > 1 ? "every " + every + "days" : "daily";
  } else if (rule.freq === "weekly") {
    const days = (rule.weekdays?.length ? rule.weekdays : []).map((d) => WEEKDAY_LABELS[d]);
    const weekdayPart = days.length ? " on " + days.join(", ") : "";
    cadence = (rule.interval > 1 ? "every " + every + "weeks" : "weekly") + weekdayPart;
  } else if (rule.freq === "monthly") {
    const base = rule.interval > 1 ? "every " + every + "months" : "monthly";
    cadence = base + monthlyAnchorPart(rule);
  } else {
    const base = rule.interval > 1 ? "every " + every + "years" : "yearly";
    cadence = base + monthlyAnchorPart(rule);
  }
  return "Repeats " + cadence + " until " + untilLabel;
}

function monthlyAnchorPart(rule: RecurrenceRule): string {
  if (rule.nthWeekday) {
    const ord = ORDINAL_LABELS[rule.nthWeekday.week] ?? "";
    const day = WEEKDAY_LABELS[rule.nthWeekday.weekday] ?? "";
    return ord && day ? " on the " + ord + " " + day : "";
  }
  if (rule.monthDay) return " on day " + rule.monthDay;
  return "";
}
