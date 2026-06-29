// "Stops" — the grouping behind the multi-event-per-slot calendar model, kept
// pure so it's unit-tested in isolation (CalendarShell wires it to rendering).
//
// A stop is the timed events that share one exact (date, startMin). A group is a
// stop — drawn as ONE overlay marker rather than as FullCalendar events — when it
// holds more than one event OR any 0-minute event (a reminder). A SOLO non-zero
// event is NOT a stop: it stays a native FC card with full drag/resize/select.
// An all-0-min stop renders as a dot + count; a stop with real events renders as
// a stacked "lined up" card.

import type { CalendarEvent } from "./types";

export type CalendarStop = {
  key: string; // dateKey + "|" + startMin
  date: string;
  startMin: number;
  events: CalendarEvent[];
  allZero: boolean; // every member is 0-min → dot + count, not a stacked card
};

const isZero = (e: CalendarEvent): boolean => e.endMin === e.startMin;

export function groupStops(events: CalendarEvent[]): CalendarStop[] {
  const buckets = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (event.allDay) continue; // all-day events live in their own row, never a stop
    const key = event.date + "|" + event.startMin;
    const arr = buckets.get(key);
    if (arr) arr.push(event);
    else buckets.set(key, [event]);
  }
  const out: CalendarStop[] = [];
  for (const [key, group] of buckets) {
    const isStop = group.length > 1 || group.some(isZero);
    if (!isStop) continue;
    // Real (longer) events first, longest first; 0-min reminders last; stable by
    // title then id so the stacked card order is deterministic across renders.
    group.sort(
      (a, b) =>
        b.endMin - b.startMin - (a.endMin - a.startMin) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
    );
    out.push({
      key,
      date: group[0].date,
      startMin: group[0].startMin,
      events: group,
      allZero: group.every(isZero),
    });
  }
  return out;
}

// The ids of every event that belongs to a stop — pulled out of FC + the
// selection spine and drawn by the stop-marker renderer instead.
export function stopEventIds(stops: CalendarStop[]): Set<string> {
  const set = new Set<string>();
  for (const stop of stops) for (const event of stop.events) set.add(event.id);
  return set;
}
