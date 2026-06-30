// "Stops" — the reminder grouping for the calendar, kept pure so it's unit-tested
// in isolation (CalendarShell wires it to rendering).
//
// A stop is the 0-minute REMINDERS that share one exact (date, startMin), drawn as
// ONE floating overlay marker — a full-width hairline + dot — rather than as
// FullCalendar events. Drawing them OUTSIDE FC's layout is deliberate: a reminder
// is a point in time that must read as a clean line BETWEEN blocks and must never
// split/cut a block it shares a time with (which a native FC event always would).
// A lone reminder is one dot; several at one minute share a dot with a count. Real
// (non-zero) events are NEVER stops: each stays a native FC card with full
// drag/resize/select, and two real events at one start sit side by side.

import type { CalendarEvent } from "./types";

export type CalendarStop = {
  key: string; // dateKey + "|" + startMin
  date: string;
  startMin: number;
  events: CalendarEvent[]; // all 0-min reminders sharing this exact start
};

const isZero = (e: CalendarEvent): boolean => e.endMin === e.startMin;

export function groupStops(events: CalendarEvent[]): CalendarStop[] {
  const buckets = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (event.allDay) continue; // all-day events live in their own row, never a stop
    if (!isZero(event)) continue; // only 0-min reminders form a stop; real events stay native FC cards
    const key = event.date + "|" + event.startMin;
    const arr = buckets.get(key);
    if (arr) arr.push(event);
    else buckets.set(key, [event]);
  }
  const out: CalendarStop[] = [];
  for (const [key, group] of buckets) {
    // Stable by title then id so the dot's listed order is deterministic.
    group.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    out.push({ key, date: group[0].date, startMin: group[0].startMin, events: group });
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
