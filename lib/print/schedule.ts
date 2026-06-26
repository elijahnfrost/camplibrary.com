// Camp Library — pure schedule selection + grouping for the Print tab.
//
// All date math goes through the app's local DateKey helpers (no UTC/DST
// drift), mirroring the calendar. Kept free of React and rendering so the
// range/selection rules are unit-testable.

import { addDays, fromDateKey } from "@/lib/calendar/dates";
import type { CalendarEvent, DateKey } from "@/lib/calendar/types";

// A printed range is bounded so a fat-fingered "year 3000" end date can't try
// to lay out tens of thousands of empty days. A quarter is well past any real
// camp session printed in one go.
export const MAX_PRINT_DAYS = 92;

// Inclusive list of DateKeys from start..end (auto-swapped if reversed),
// capped at MAX_PRINT_DAYS so the document can never run away.
export function enumerateDates(start: DateKey, end: DateKey): DateKey[] {
  let lo = start;
  let hi = end;
  if (fromDateKey(lo).getTime() > fromDateKey(hi).getTime()) {
    lo = end;
    hi = start;
  }
  const out: DateKey[] = [];
  let cursor = lo;
  for (let i = 0; i < MAX_PRINT_DAYS; i++) {
    out.push(cursor);
    if (cursor === hi) break;
    cursor = addDays(cursor, 1);
  }
  return out;
}

export interface EventSelection {
  start: DateKey;
  end: DateKey;
  // null = every camp. Otherwise only events tagged with this camp id.
  campId: string | null;
  // The set of real camp ids, so an event whose camp was deleted (dangling
  // campId) is treated as unscoped rather than silently dropped under "All".
  campIds: Set<string>;
  includeAllDay: boolean;
}

// Events that fall inside the range and match the camp/all-day filters.
export function selectEvents(
  events: Record<string, CalendarEvent>,
  selection: EventSelection
): CalendarEvent[] {
  const dates = new Set(enumerateDates(selection.start, selection.end));
  return Object.values(events).filter((event) => {
    if (!dates.has(event.date)) return false;
    if (event.allDay && !selection.includeAllDay) return false;
    if (selection.campId != null) {
      const resolved = event.campId && selection.campIds.has(event.campId) ? event.campId : null;
      if (resolved !== selection.campId) return false;
    }
    return true;
  });
}

// One day's events in reading order: all-day first, then by start time, with a
// stable tiebreak on title so equal-time events don't reshuffle between renders.
export function sortDayEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    const aAll = a.allDay ? 0 : 1;
    const bAll = b.allDay ? 0 : 1;
    if (aAll !== bAll) return aAll - bAll;
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    if (a.endMin !== b.endMin) return a.endMin - b.endMin;
    return a.title.localeCompare(b.title);
  });
}

export interface ScheduleDay {
  date: DateKey;
  events: CalendarEvent[];
}

// Trim a built day list by the per-print content selection: drop whole days the
// user excluded, and drop individually-excluded events from the days that stay.
// Pure (no React) so the include/exclude rules are unit-testable; an excluded day
// is removed entirely rather than printed empty.
export function applyExclusions(
  days: ScheduleDay[],
  excludedDays: readonly DateKey[],
  excludedEventIds: readonly string[]
): ScheduleDay[] {
  if (excludedDays.length === 0 && excludedEventIds.length === 0) return days;
  const dayOut = new Set(excludedDays);
  const eventOut = new Set(excludedEventIds);
  return days
    .filter((day) => !dayOut.has(day.date))
    .map((day) =>
      eventOut.size === 0
        ? day
        : { date: day.date, events: day.events.filter((event) => !eventOut.has(event.id)) }
    );
}

// The range as a list of days (each with its sorted events). Empty days are
// kept or dropped per `includeEmptyDays`, but the first/last day of the chosen
// range always survive so the printout spans exactly what was asked for.
export function buildScheduleDays(
  selected: CalendarEvent[],
  start: DateKey,
  end: DateKey,
  includeEmptyDays: boolean
): ScheduleDay[] {
  const byDate = new Map<DateKey, CalendarEvent[]>();
  for (const event of selected) {
    const list = byDate.get(event.date);
    if (list) list.push(event);
    else byDate.set(event.date, [event]);
  }
  const dates = enumerateDates(start, end);
  const lastIndex = dates.length - 1;
  const days: ScheduleDay[] = [];
  dates.forEach((date, index) => {
    const events = byDate.get(date);
    const isEdge = index === 0 || index === lastIndex;
    if (!events && !includeEmptyDays && !isEdge) return;
    days.push({ date, events: events ? sortDayEvents(events) : [] });
  });
  return days;
}
