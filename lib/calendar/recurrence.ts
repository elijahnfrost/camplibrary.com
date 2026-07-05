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

type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

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
  /** Weekday blackout (0 = Sunday … 6 = Saturday), sorted + de-duped. Subtracts
   *  matching weekdays from the expansion on EVERY frequency (e.g. "daily except
   *  Wed", "every 3 days but never on a Sunday"). For a weekly rule this is
   *  redundant with the positive `weekdays` set, so normalizeRecurrence folds it
   *  into `weekdays` and drops the term — there is exactly ONE canonical form for
   *  a weekly cadence. The DTSTART-always-included contract wins over it: the
   *  anchor date is always emitted even if its weekday is blacked out. */
  exceptWeekdays?: number[];
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

// The blackout set, cleaned the same way but ALLOWED to be empty (an empty
// blackout is meaningful only as "no term" — we drop it). Returns the sorted,
// de-duped list, or null when nothing valid remains (so callers treat it as
// absent). Shares cleanWeekdays' 0..6 integer guard.
function cleanExceptWeekdays(raw: unknown): number[] | null {
  return cleanWeekdays(raw);
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

  // The blackout term is accepted on every frequency. A blackout that covers
  // ALL SEVEN weekdays can never generate anything, so it degrades the rule to
  // null exactly like any other malformed payload (the anchor-always-emitted
  // contract does not rescue a fully-blacked-out RULE — a rule that can only
  // ever place its own start date is not a recurrence).
  const exceptWeekdays = cleanExceptWeekdays(value.exceptWeekdays);
  if (exceptWeekdays && exceptWeekdays.length >= 7) return null;

  if (value.freq === "weekly") {
    const weekdays = cleanWeekdays(value.weekdays);
    if (weekdays) {
      // CANONICALIZATION: a weekly blackout is redundant with the positive set,
      // so fold it in and drop the term — one canonical form per cadence. If the
      // subtraction empties the set the rule can generate nothing → invalid.
      const folded = exceptWeekdays
        ? weekdays.filter((d) => !exceptWeekdays.includes(d))
        : weekdays;
      if (!folded.length) return null;
      rule.weekdays = folded;
    } else if (exceptWeekdays) {
      // No explicit positive set: the weekly rule lands on the START's own
      // weekday. We can't fold without the start date, so keep the term as a
      // general blackout (the expander subtracts it, and the anchor still wins).
      // It's already known not to cover all 7 (guarded above), so a generatable
      // weekday always survives once the anchor is counted.
      rule.exceptWeekdays = exceptWeekdays;
    }
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

  // Daily / monthly / yearly keep the blackout as a live term (weekly already
  // folded it above). It subtracts matching weekdays from the expansion; the
  // anchor date still wins per the DTSTART contract.
  if (value.freq !== "weekly" && exceptWeekdays) {
    rule.exceptWeekdays = exceptWeekdays;
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
  const ax = a.exceptWeekdays ?? [];
  const bx = b.exceptWeekdays ?? [];
  if (ax.length !== bx.length || !ax.every((d, i) => d === bx[i])) return false;
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

  // Weekday blackout. The anchor (startDate) is pushed above and never re-tested,
  // so it is always emitted even when its own weekday is blacked out — the
  // DTSTART-always-included contract wins over exceptWeekdays. Only GENERATED
  // candidates are filtered against this set.
  const blocked = rule.exceptWeekdays?.length ? new Set(rule.exceptWeekdays) : null;
  const isBlocked = (key: DateKey): boolean => (blocked ? blocked.has(dow(key)) : false);

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
      if (include && !isBlocked(cursor)) out.push(cursor);
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
      if (candidate && candidate > startDate && !isBlocked(candidate)) out.push(candidate);
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
      if (candidate && candidate > startDate && !isBlocked(candidate)) out.push(candidate);
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
  locations?: string[];
  note?: string;
  // A pinned occurrence must stay pinned across a "following"/"all" regeneration
  // (which rebuilds occurrences from the template). Without this carry-through a
  // regeneration would silently drop the pin, so a pinned series edited "all"
  // would un-pin itself. Threaded through buildTemplate off the edited row.
  pinned?: boolean;
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
  if (template.locations?.length) event.locations = [...template.locations];
  if (template.note) event.note = template.note;
  if (template.pinned) event.pinned = true;
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

// The event fields a this-scoped / bulk edit may durably override on a series
// member; a regeneration then preserves those fields instead of rebuilding them.
// Mirrors CUSTOMIZABLE_FIELDS in types.ts — duplicated (not imported) to keep
// this module free of a value import back from types.ts (types.ts imports THIS
// module for normalization, so a value import would be a cycle). Kept in sync by
// the round-trip tests. Anything not in this set is never stamped into `custom`.
const CUSTOMIZABLE_FIELDS = [
  "date",
  "startMin",
  "endMin",
  "allDay",
  "title",
  "activityId",
  "kind",
  "color",
  "locations",
  "note",
  "campId",
  "pinned",
  "alternates",
  "materialSubs",
  "linkId",
  "headcount",
] as const;
type CustomizableField = (typeof CUSTOMIZABLE_FIELDS)[number];
const CUSTOMIZABLE_FIELD_SET = new Set<string>(CUSTOMIZABLE_FIELDS);

// The single rule slot a series member occupies. A this-edit that MOVES the date
// stamps `origDate` with the row's original rule date; every skip-set and
// preservation decision keys off this slot — exactly ONE slot per row (origDate
// when the date moved, else the live date). Stamping BOTH would let one row claim
// two rule dates and silently kill an unrelated sibling occurrence.
function slotOf(event: CalendarEvent): DateKey {
  return event.origDate ?? event.date;
}

// A "customized" occurrence carries at least one durably-overridden field. Such
// rows are PRESERVED (never rebuilt) across a following/all regeneration.
function isCustomized(event: CalendarEvent): boolean {
  return Array.isArray(event.custom) && event.custom.length > 0;
}

// Read a customizable field off an event by name (typed narrow over the known
// set). Used by the per-field merge to copy a preserved row's own value back
// over the regenerated template value.
function readField(event: CalendarEvent, field: CustomizableField): unknown {
  return (event as unknown as Record<string, unknown>)[field];
}

// Assign a customizable field on a draft event by name. `undefined` deletes the
// key so a customized override of "cleared" (e.g. note removed) round-trips as
// absence rather than an explicit undefined.
function writeField(target: CalendarEvent, field: CustomizableField, val: unknown): void {
  const bag = target as unknown as Record<string, unknown>;
  if (val === undefined) delete bag[field];
  else bag[field] = val;
}

// Shallow structural equality for customizable-field values (primitives,
// arrays, plain objects). Used by planOccurrenceEdit to decide which fields a
// this-edit actually changed. A JSON round-trip is sufficient here: the values
// are small, plain (DateKey / number / boolean / string / arrays of those /
// shallow record), and key order in our normalized objects is stable — this
// avoids a bespoke deep-equal while still catching a no-op edit.
function fieldsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Union `changedFields` (whitelist-filtered) into an event's `custom` list,
// preserving existing entries, and stamp `origDate` when "date" is newly among
// the changes and no origDate is set yet (the row's first date move records the
// rule slot it used to occupy). Pure — returns a new event; the ONE place the UI
// wave's group-drag / bulk-edit paths get durable stamping right.
export function applyCustomStamp(event: CalendarEvent, changedFields: string[]): CalendarEvent {
  const valid = changedFields.filter((f) => CUSTOMIZABLE_FIELD_SET.has(f));
  if (!valid.length) return event;
  const custom = [...new Set([...(event.custom ?? []), ...valid])];
  const next: CalendarEvent = { ...event, custom };
  if (valid.includes("date") && next.origDate === undefined && event.date !== undefined) {
    // origDate captures the rule slot the row occupied BEFORE this move, so the
    // regeneration can decide whether that slot still lives (and never resurrect
    // it as a duplicate). We can only capture it here if the caller hasn't
    // already changed event.date — callers stamp BEFORE writing the new date, or
    // pass the pre-move event. When origDate is already set, an earlier move
    // recorded the true slot; keep it.
    next.origDate = event.date;
  }
  return next;
}

// Re-apply a preserved (customized) row's own values over a freshly regenerated
// template row: start from `regenerated` (new rule + template fields), then copy
// back every field the row named in its `custom` list, and keep the row's stable
// identity fields (id, date, custom, origDate). The result is the merged upsert.
// Non-customized rows never take this path — they're rebuilt wholesale from the
// template so template-carried fields (pinned, note, color, …) always refresh.
function mergeCustomizedRow(preserved: CalendarEvent, regenerated: CalendarEvent): CalendarEvent {
  const merged: CalendarEvent = {
    ...regenerated,
    id: preserved.id,
    date: preserved.date,
    updatedAt: Date.now(),
  };
  for (const name of preserved.custom ?? []) {
    if (CUSTOMIZABLE_FIELD_SET.has(name)) {
      const field = name as CustomizableField;
      writeField(merged, field, readField(preserved, field));
    }
  }
  // Keep the row's own customization bookkeeping verbatim: which fields it owns
  // and the rule slot it occupies (origDate). "date" being in `custom` already
  // pinned merged.date above; origDate is copied here so the slot survives.
  merged.custom = [...(preserved.custom ?? [])];
  if (preserved.origDate !== undefined) merged.origDate = preserved.origDate;
  else delete merged.origDate;
  return merged;
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
//
// CUSTOMIZED ROWS (rule 3): an occurrence carrying a non-empty `custom` list is
// a user-owned exception. On regeneration it is NOT rebuilt — if its slot
// (origDate ?? date) still lives in the new rule's expansion range, it is
// preserved and re-emitted as a per-field MERGE (regenerated template values,
// then the row's own values re-applied for every field it named). If the new
// rule's horizon cuts the slot off, the row is dropped with the slice. Its slot
// is added to the regeneration skip-set so the fresh expansion never also plants
// a duplicate on that day.
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

  // The customized rows in scope that must be PRESERVED, keyed by their rule slot.
  // The edited target itself is excluded — its new values ARE the template, so it
  // is always regenerated, not preserved. A preserved row's slot is skipped in
  // the fresh expansion so we never plant a duplicate on the same day.
  const preservedBySlot = new Map<DateKey, CalendarEvent>();
  for (const event of affected) {
    if (event.id !== target.id && isCustomized(event)) {
      preservedBySlot.set(slotOf(event), event);
    }
  }

  // Where the regenerated portion starts. "Following" starts at the edited day.
  // "All" starts at the earliest LIVE date OR the earliest preserved-row SLOT,
  // whichever is earlier — a "this" edit that dragged the first occurrence
  // forward must not orphan its original rule slot outside the regeneration span.
  const earliestSlot = [...preservedBySlot.keys()].sort()[0];
  let anchorDate = scope === "all" ? (series[0]?.date ?? draftDate) : draftDate;
  if (scope === "all" && earliestSlot && earliestSlot < anchorDate) anchorDate = earliestSlot;

  // Repeat cleared for this scope → collapse to the single anchor occurrence as
  // a standalone event; earlier occurrences (for "following") are left alone.
  // Customized rows are dropped with the slice too (Google semantics: clearing
  // the rule ends the pattern, so nothing regenerates and no exception survives).
  if (!rule) {
    const anchorId = affected.find((event) => event.date === anchorDate)?.id ?? target.id;
    return { upserts: [occurrence(template, anchorDate, anchorId)], removes };
  }

  // The preserved rows we will actually re-emit: those whose SLOT still lives
  // inside the new horizon [anchorDate, until]. A row whose slot the shorter
  // `until` cuts off is dropped with the slice (it stays in `removes`).
  const survivingPreserved: CalendarEvent[] = [];
  for (const [slot, row] of preservedBySlot) {
    if (slot >= anchorDate && slot <= rule.until) survivingPreserved.push(row);
  }
  // The live days those survivors occupy. The fresh expansion must NOT plant a
  // duplicate on a day a preserved row already holds (its live date may differ
  // from its slot, e.g. a moved row that landed on a natural rule date). This is
  // a TRANSIENT de-dup for this one regeneration, kept OUT of the stored exdates
  // (the slot — one per row — is the durable skip).
  const preservedLiveDates = new Set(survivingPreserved.map((row) => row.date));

  // Carry skipped days that live inside the regenerated range forward, so the
  // regeneration honours them rather than blindly recreating every date, and add
  // every preserved row's SLOT to the durable skip-set (exactly one slot per row,
  // never its live date — stamping the live date could kill a live sibling).
  const carried = gatheredExdates(series, anchorDate, rule.until);
  const merged = new Set([
    ...(rule.exdates ?? []),
    ...carried,
    ...survivingPreserved.map(slotOf),
  ]);
  const ruleWithExdates = withExdates(rule, [...merged].filter((d) => d >= anchorDate).sort());

  // Regenerate from the earliest affected occurrence so "all" keeps the season's
  // original start while adopting the new time/details, and "following" starts at
  // the edited day. The anchor keeps a stable id. When a preserved row already
  // holds the anchor date it is filtered out of `dates` below, so the anchorId is
  // simply never claimed by a fresh row — the preserved merge carries identity.
  const anchorRow = affected.find((event) => event.date === anchorDate);
  const anchorId = anchorRow?.id ?? target.id;
  const rawDates = recurrenceDates(anchorDate, ruleWithExdates);
  // Drop any fresh date a preserved row already occupies (transient de-dup).
  const dates = rawDates.filter((d) => !preservedLiveDates.has(d));
  const regenerated = buildSeriesEvents(
    template,
    dates,
    seriesId,
    ruleWithExdates,
    newId,
    anchorDate,
    anchorId
  );

  // Re-emit each surviving preserved row as a per-field MERGE over the
  // regenerated template values, stamping the fresh rule + seriesId. The merge
  // base carries the template fields; the row's own values then win for every
  // field it customized.
  const upserts: CalendarEvent[] = [...regenerated];
  for (const row of survivingPreserved) {
    const base = occurrence(template, row.date, row.id, seriesId, ruleWithExdates);
    upserts.push(mergeCustomizedRow(row, base));
  }
  // Keep the plan date-ordered so callers (and tests) see a stable shape.
  upserts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { upserts, removes };
}

// The "this"-edit planner (rule 4): writes exactly ONE row. Diffs `target`
// against `next` over the customizable fields, unions the changed names into
// `custom` (deduped, previous entries preserved), stamps `origDate := target's
// slot` when the date changed, and KEEPS the original rule (a rule change at
// this-scope is ignored — the existing this-edit semantic). Returns a single
// upsert and no removes. This is the seam the UI wave adopts for instant "this"
// edits; existing CalendarShell flows keep working without it for now.
export function planOccurrenceEdit(
  series: CalendarEvent[],
  target: CalendarEvent,
  next: CalendarEvent
): SeriesEditPlan {
  const changed: string[] = [];
  for (const field of CUSTOMIZABLE_FIELDS) {
    if (!fieldsEqual(readField(target, field), readField(next, field))) changed.push(field);
  }
  const dateMoved = target.date !== next.date;
  const custom = [...new Set([...(target.custom ?? []), ...changed])];
  const row: CalendarEvent = {
    ...next,
    // A this-edit never changes the pattern: keep the target's original rule and
    // series identity regardless of what `next` carried.
    seriesId: target.seriesId,
    recurrence: target.recurrence,
    updatedAt: Date.now(),
  };
  if (custom.length) row.custom = custom;
  else delete row.custom;
  // origDate captures the rule slot this exception used to occupy, set on the
  // FIRST date move and then frozen (a later move keeps the true original slot,
  // so the series never resurrects the original day as a duplicate).
  if (dateMoved) {
    row.origDate = target.origDate ?? target.date;
  } else if (target.origDate !== undefined) {
    row.origDate = target.origDate;
  } else {
    delete row.origDate;
  }
  return { upserts: [row], removes: [] };
}

// "Skip this day" — remove a single occurrence from a series AND record its
// rule slot as an exdate on every surviving occurrence's rule, so a later
// "all"/"following" regeneration won't bring it back. The slot is `origDate ??
// date` (exactly one), so deleting a MOVED customized row skips the day it used
// to occupy — never the day it was dragged onto, which may be a live sibling's
// legitimate slot. Returns the surviving occurrences to re-upsert (with the
// updated rule) and the skipped occurrence id to remove. A no-op-safe helper:
// returns just the removal when the occurrence carries no rule.
export function planSeriesSkip(series: CalendarEvent[], target: CalendarEvent): SeriesEditPlan {
  if (!target.seriesId || !target.recurrence) {
    return { upserts: [], removes: [target.id] };
  }
  const slot = slotOf(target);
  const survivors = series.filter((event) => event.id !== target.id);
  const upserts = survivors.map((event) => {
    const base = event.recurrence ?? target.recurrence!;
    const exdates = [...new Set([...(base.exdates ?? []), slot])].sort();
    return { ...event, recurrence: withExdates(base, exdates), updatedAt: Date.now() };
  });
  return { upserts, removes: [target.id] };
}

// Batch "skip these days" (rule 5): union every skipped row's slot into every
// SURVIVOR's exdates in one pass, then remove the skipped rows. One plan, one
// undo. Slots come from `dates` PLUS each skipped row's own slot (origDate ??
// date) so deleting moved customized rows records the right days. Robust to a
// target list that includes non-series ids (they're just removed).
export function planSeriesSkipMany(series: CalendarEvent[], dates: DateKey[]): SeriesEditPlan {
  const skipIds = new Set<string>();
  const slots = new Set<DateKey>(dates.filter(isDateKey));
  for (const event of series) {
    // A row is skipped when its live date OR its rule slot is named.
    if (slots.has(event.date) || slots.has(slotOf(event))) {
      skipIds.add(event.id);
      slots.add(slotOf(event));
    }
  }
  const survivors = series.filter((event) => !skipIds.has(event.id));
  const sortedSlots = [...slots].sort();
  const upserts = survivors.map((event) => {
    const base = event.recurrence;
    if (!base) return { ...event, updatedAt: Date.now() };
    const exdates = [...new Set([...(base.exdates ?? []), ...sortedSlots])].sort();
    return { ...event, recurrence: withExdates(base, exdates), updatedAt: Date.now() };
  });
  return { upserts, removes: [...skipIds] };
}

// "Un-skip this day" (rule 6): strip `date` from every surviving row's exdates
// and mint ONE fresh occurrence on that day. The template is the nearest
// surviving row (by date distance) whose own rule actually generates `date`, so
// the restored occurrence adopts a compatible time-of-day / identity; it falls
// back to any surviving row when none matches (e.g. the day was only ever
// reachable as the anchor). A no-op-safe helper: returns an empty plan when
// there are no survivors to seed from.
export function planRestoreOccurrence(
  series: CalendarEvent[],
  date: DateKey,
  newId: () => string
): SeriesEditPlan {
  if (!series.length) return { upserts: [], removes: [] };

  // Strip the day from every row's exdates so a later regeneration keeps it live.
  const cleared = series.map((event) => {
    const base = event.recurrence;
    if (!base?.exdates?.length || !base.exdates.includes(date)) {
      return { ...event, updatedAt: Date.now() };
    }
    const exdates = base.exdates.filter((d) => d !== date);
    return { ...event, recurrence: withExdates(base, exdates), updatedAt: Date.now() };
  });

  // Prefer a template whose rule genuinely places `date` (so the restored time
  // matches the pattern), nearest by date; else the nearest survivor overall.
  const byDistance = [...cleared].sort(
    (a, b) => Math.abs(daySpan(a.date, date)) - Math.abs(daySpan(b.date, date))
  );
  const generator = byDistance.find((event) => {
    const rule = event.recurrence;
    return rule ? rawRecurrenceDates(event.date, rule).includes(date) : false;
  });
  const templateRow = generator ?? byDistance[0];

  const restored: CalendarEvent = {
    ...templateRow,
    id: newId(),
    date,
    updatedAt: Date.now(),
  };
  // A restored day is a clean rule occurrence, not an exception: drop any
  // customization bookkeeping the template row happened to carry.
  delete restored.custom;
  delete restored.origDate;
  return { upserts: [...cleared, restored], removes: [] };
}

// "Reset to series" (P3): rebuild ONE customized occurrence back to a plain
// series member, discarding its per-field overrides. The template is the nearest
// NON-customized sibling (by date distance) — the freshest picture of what an
// untouched occurrence looks like right now (its title/time/color/… as the rest
// of the series carries them). With no clean sibling (every row is customized, or
// it's a lone occurrence) we fall back to stripping the row's own custom fields
// in place: keep identity (id/date/seriesId/rule) but drop the `custom`/`origDate`
// bookkeeping, so the row still reads as whatever it currently shows minus the
// exception status. One upsert, no removes. A no-op-safe helper: returns just the
// target reset when it carries no series. The reset row regenerates normally on a
// later following/all edit (it's no longer preserved, so the template wins).
export function planResetOccurrence(
  series: CalendarEvent[],
  target: CalendarEvent
): SeriesEditPlan {
  // The freshest clean sibling — a same-series row that is NOT itself customized,
  // nearest to the target by date. Its fields are the series template as it lives.
  const clean = series
    .filter((event) => event.id !== target.id && event.seriesId === target.seriesId && !isCustomized(event))
    .sort((a, b) => Math.abs(daySpan(a.date, target.date)) - Math.abs(daySpan(b.date, target.date)))[0];

  let row: CalendarEvent;
  if (clean) {
    // Rebuild from the clean sibling's template fields, but keep the target's own
    // identity + slot (id / date / seriesId / rule). Every customizable field is
    // taken from the sibling; anything the sibling doesn't carry is cleared.
    row = {
      ...clean,
      id: target.id,
      date: target.date,
      seriesId: target.seriesId,
      recurrence: target.recurrence,
      updatedAt: Date.now(),
    };
  } else {
    // No clean sibling: strip the exception status in place, keeping the row's
    // current visible values (there is no fresher template to adopt).
    row = { ...target, updatedAt: Date.now() };
  }
  delete row.custom;
  delete row.origDate;
  return { upserts: [row], removes: [] };
}

// Bulk-delete durability (rule 7): given the full event map values and a set of
// ids to delete, group the ids by seriesId and produce a SINGLE plan that skips
// series members durably (their slots become exdates on the surviving rows, so a
// later "all"/"following" edit can't resurrect them) while plainly removing every
// non-series id. Without this, a bulk delete just drops rows and a subsequent
// "all" regeneration brings the deleted days back.
export function planBulkSeriesRemovals(
  events: CalendarEvent[],
  ids: string[]
): SeriesEditPlan {
  const byId = new Map(events.map((event) => [event.id, event]));
  const bySeries = new Map<string, CalendarEvent[]>();
  const plainRemoves: string[] = [];
  const targetsBySeries = new Map<string, Set<string>>();

  for (const id of ids) {
    const event = byId.get(id);
    if (event?.seriesId && event.recurrence) {
      const key = event.seriesId;
      if (!targetsBySeries.has(key)) targetsBySeries.set(key, new Set());
      targetsBySeries.get(key)!.add(id);
    } else {
      // A non-series id (or a series member with a broken/absent rule) is just
      // removed — there is nothing durable to record.
      plainRemoves.push(id);
    }
  }

  // Gather each affected series' full membership from the event map so the skip
  // plan can stamp every survivor, not just the selected rows.
  for (const seriesId of targetsBySeries.keys()) {
    bySeries.set(
      seriesId,
      events
        .filter((event) => event.seriesId === seriesId)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    );
  }

  const upserts: CalendarEvent[] = [];
  const removes: string[] = [...plainRemoves];
  // Track survivors per series so multiple skips within one series compose onto
  // the SAME survivor rows (later slots union onto the earlier upsert).
  const survivorState = new Map<string, CalendarEvent[]>();

  for (const [seriesId, targetIds] of targetsBySeries) {
    const members = bySeries.get(seriesId) ?? [];
    const skipRows = members.filter((event) => targetIds.has(event.id));
    const dates = skipRows.map(slotOf);
    const plan = planSeriesSkipMany(members, dates);
    survivorState.set(seriesId, plan.upserts);
    removes.push(...plan.removes);
  }
  for (const rows of survivorState.values()) upserts.push(...rows);

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
  // Weekly folds its blackout into the positive set, so an exceptWeekdays clause
  // only ever surfaces on daily / monthly / yearly — e.g. "Repeats daily · except
  // Wed until Jul 31".
  const exceptPart =
    rule.freq !== "weekly" && rule.exceptWeekdays?.length
      ? " · except " + rule.exceptWeekdays.map((d) => WEEKDAY_LABELS[d]).join(", ")
      : "";
  return "Repeats " + cadence + exceptPart + " until " + untilLabel;
}

// Does this rule's expansion from `startDate` actually get cut short by the
// MAX_SERIES_OCCURRENCES / MAX_SCAN_DAYS / MAX_UNIT_STEPS backstops, before it
// reaches `until`? Compares the raw (pre-exdate) occurrence count against the
// cap AND checks whether the last emitted date still falls short of `until` —
// a rule can legitimately emit fewer than the cap and still reach `until` (e.g.
// a short weekly span), so count alone isn't sufficient. Pure, so RepeatField
// can surface a quiet inline note without duplicating the cap logic itself.
export function recurrenceIsTruncated(startDate: DateKey, rule: RecurrenceRule): boolean {
  if (!isDateKey(startDate)) return false;
  const raw = rawRecurrenceDates(startDate, rule);
  if (raw.length < MAX_SERIES_OCCURRENCES) return false;
  const last = raw[raw.length - 1];
  return last < rule.until;
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
