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
import { addDays, daySpan, fromDateKey } from "./dates";

// A local DateKey guard. types.ts imports normalizeRecurrence from here (to keep
// the series fields through normalization), so this module avoids a value import
// back from types.ts — it only depends on it for types (erased at compile).
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function isDateKey(value: unknown): value is DateKey {
  return typeof value === "string" && DATE_KEY_PATTERN.test(value);
}

export type RecurrenceFreq = "daily" | "weekly";

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** Every N days / weeks. Always ≥ 1. */
  interval: number;
  /** Weekly only: which weekdays land an occurrence (0 = Sunday … 6 = Saturday),
   *  sorted, de-duped, non-empty. Omitted for daily. */
  weekdays?: number[];
  /** Inclusive last date the series may place an occurrence on. */
  until: DateKey;
}

// A series never expands past this many occurrences — a hard backstop against a
// far-future `until` (a daily year is 366) generating an unbounded write storm.
export const MAX_SERIES_OCCURRENCES = 366;
// The day-by-day scan also can't run forever even if it places nothing.
const MAX_SCAN_DAYS = 800;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dow(key: DateKey): number {
  return fromDateKey(key).getDay();
}

// Sunday-anchored start of the week containing `key`, so the weekly interval can
// count whole weeks between two dates regardless of which weekday each falls on.
function weekAnchor(key: DateKey): DateKey {
  return addDays(key, -dow(key));
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

// Parse an untrusted value (localStorage cache or API payload) into a
// RecurrenceRule, returning null for anything malformed so a bad payload just
// degrades the event to a plain one rather than throwing.
export function normalizeRecurrence(raw: unknown): RecurrenceRule | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.freq !== "daily" && value.freq !== "weekly") return null;
  if (!isDateKey(value.until)) return null;
  const interval =
    typeof value.interval === "number" && Number.isInteger(value.interval) && value.interval >= 1
      ? Math.min(value.interval, 52)
      : 1;
  const rule: RecurrenceRule = { freq: value.freq, interval, until: value.until };
  if (value.freq === "weekly") {
    const weekdays = cleanWeekdays(value.weekdays);
    if (weekdays) rule.weekdays = weekdays;
  }
  return rule;
}

export function rulesEqual(a: RecurrenceRule | undefined, b: RecurrenceRule | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.freq !== b.freq || a.interval !== b.interval || a.until !== b.until) return false;
  const aw = a.weekdays ?? [];
  const bw = b.weekdays ?? [];
  return aw.length === bw.length && aw.every((d, i) => d === bw[i]);
}

// The ordered, unique occurrence dates a rule places from `startDate` through
// `rule.until` (inclusive). The start date is ALWAYS the first occurrence — the
// event you placed never moves out from under you, even if its weekday isn't in
// a weekly rule's selected set. A simple day-by-day scan keeps the weekly /
// interval / weekday logic in one obvious place; it's bounded by both the date
// horizon and the occurrence/scan caps.
export function recurrenceDates(startDate: DateKey, rule: RecurrenceRule): DateKey[] {
  if (!isDateKey(startDate)) return [];
  const out: DateKey[] = [startDate];
  if (rule.until <= startDate) return out;

  const interval = Math.max(1, rule.interval);
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

// A scoped edit. "This" rewrites the single occurrence in place (it stays in the
// series as an exception, or detaches to a standalone event when the rule is
// cleared). "Following" and "All" REGENERATE their portion of the series from
// the edited draft as the new template + rule — so whatever the user set in the
// editor (time, length, title, activity, repeat pattern) becomes the pattern
// going forward (following) or for the whole series (all), exactly the Google
// Calendar mental model. A cleared rule collapses the chosen scope down to the
// single edited occurrence. The anchor occurrence keeps a stable id.
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

  // Regenerate from the earliest affected occurrence so "all" keeps the season's
  // original start while adopting the new time/details, and "following" starts at
  // the edited day.
  const dates = recurrenceDates(anchorDate, rule);
  const upserts = buildSeriesEvents(template, dates, seriesId, rule, newId, anchorDate, anchorId);
  return { upserts, removes };
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
  } else {
    const days = (rule.weekdays?.length ? rule.weekdays : []).map((d) => WEEKDAY_LABELS[d]);
    const weekdayPart = days.length ? " on " + days.join(", ") : "";
    cadence = (rule.interval > 1 ? "every " + every + "weeks" : "weekly") + weekdayPart;
  }
  return "Repeats " + cadence + " until " + untilLabel;
}
