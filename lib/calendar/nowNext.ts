"use client";

// The Now/Next read of today's schedule — extracted from the retired Home tab so
// the calendar rail's "Today" card and any future consumer share ONE definition
// of "the block underway" and "up next". A minute-tick clock drives the pills;
// the window test is the half-open interval [startMin, endMin) so a block that
// just ended hands "now" to its successor cleanly.

import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "./types";
import { todayKey } from "./dates";
import { nowMinutes } from "./time";

export interface TodayNowNext {
  /** Today's events, all-day first, then earliest-start first. */
  todaysEvents: CalendarEvent[];
  /** The event underway right now (clockMin within [startMin, endMin)), or null. */
  nowEventId: string | null;
  /** The next upcoming timed event after now, or null. */
  nextEventId: string | null;
}

// Sort today's events for a schedule read: all-day float to the top, then by
// start time. Pure so it's testable and reused by both the memo and any caller.
export function sortTodaysEvents(events: CalendarEvent[], today: string): CalendarEvent[] {
  return events
    .filter((e) => e.date === today)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.startMin - b.startMin;
    });
}

// Resolve Now/Next from a set of today's events at a given clock minute. Timed
// events only carry Now/Next (all-day blocks have no clock window). Never
// double-badges: "next" only applies when nothing is running, or once the
// running block differs from it.
export function resolveNowNext(
  todaysEvents: CalendarEvent[],
  clockMin: number
): { nowEventId: string | null; nextEventId: string | null } {
  let nowId: string | null = null;
  let nextId: string | null = null;
  let nextStart = Infinity;
  for (const e of todaysEvents) {
    if (e.allDay) continue;
    if (clockMin >= e.startMin && clockMin < e.endMin) {
      nowId = e.id;
    } else if (e.startMin >= clockMin && e.startMin < nextStart) {
      nextStart = e.startMin;
      nextId = e.id;
    }
  }
  if (nowId && nextId === nowId) nextId = null;
  return { nowEventId: nowId, nextEventId: nextId };
}

// The live hook: a minute-tick clock over today's events, yielding the sorted
// list plus the Now/Next ids. Cleans up its interval on unmount.
export function useTodayNowNext(events: Record<string, CalendarEvent>): TodayNowNext {
  const today = todayKey();
  const [clockMin, setClockMin] = useState<number>(() => nowMinutes());
  useEffect(() => {
    const id = window.setInterval(() => setClockMin(nowMinutes()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const todaysEvents = useMemo(() => sortTodaysEvents(Object.values(events), today), [events, today]);
  const { nowEventId, nextEventId } = useMemo(
    () => resolveNowNext(todaysEvents, clockMin),
    [todaysEvents, clockMin]
  );
  return { todaysEvents, nowEventId, nextEventId };
}
