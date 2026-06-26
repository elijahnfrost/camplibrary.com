// Pure helpers for the calendar's multi-event selection + group drag (T3).
// Kept library-agnostic and side-effect-free so they're unit-testable in
// isolation: no FullCalendar, no React, no DOM. CalendarShell owns the state and
// the imperative paint; this file owns the math (the range slice a shift-click
// walks, and the delta a group move applies to every selected event).

import { addDays, daySpan } from "./dates";
import { MINUTES_PER_DAY, snapMinutes } from "./time";
import type { CalendarEvent, DateKey } from "./types";

// Order every event id by (date, then startMin, then id as a stable tiebreak).
// This is the spine a shift-click range walks: "in between anchor and target" is
// simply the slice of this order between them, so a range spans days naturally
// (anchor Mon 9:00 → target Wed 14:00 sweeps in Tue). Stable so the same input
// always yields the same order regardless of the source array's order.
export function orderEventIds(events: readonly CalendarEvent[]): string[] {
  return [...events]
    .sort(
      (a, b) =>
        (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
        a.startMin - b.startMin ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .map((event) => event.id);
}

// The contiguous inclusive set of ids from the FIXED anchor through the target,
// in chronological order. Used by a shift-click range-select. If either id is
// missing from the order (a just-deleted event, say), it degrades to just the
// target so the gesture still does something predictable.
export function rangeSelection(
  order: readonly string[],
  anchor: string,
  target: string
): Set<string> {
  const ai = order.indexOf(anchor);
  const bi = order.indexOf(target);
  if (ai === -1 || bi === -1) return new Set([target]);
  const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
  return new Set(order.slice(lo, hi + 1));
}

// The date/time delta between a grabbed event's BEFORE and AFTER geometry — the
// shift a group move propagates to every other selected event. dayDelta is in
// whole days; minDelta is in minutes-of-day. allDay drops are time-flat (only
// the day shifts), so minDelta is 0 there.
export interface MoveDelta {
  dayDelta: number;
  minDelta: number;
}

export function moveDelta(before: CalendarEvent, after: CalendarEvent): MoveDelta {
  const dayDelta = daySpan(before.date, after.date);
  // An all-day before/after carries no meaningful startMin, so only the day moves.
  const minDelta = before.allDay || after.allDay ? 0 : after.startMin - before.startMin;
  return { dayDelta, minDelta };
}

// Apply a move delta to one event, preserving its own date/time (shifted by the
// delta) and its duration. The new start is snapped to the grid and the event is
// clamped within its day so a group move can never push a block out of bounds —
// exactly the per-day clamp the single-event drop path (fromFcDates) applies. An
// all-day event only shifts its day. Returns a fresh event with a bumped
// updatedAt (the last-write-wins store needs it to re-accept the row).
export function applyMoveDelta(event: CalendarEvent, delta: MoveDelta): CalendarEvent {
  const date: DateKey = delta.dayDelta ? addDays(event.date, delta.dayDelta) : event.date;
  if (event.allDay) {
    return { ...event, date, updatedAt: Date.now() };
  }
  const duration = Math.max(1, event.endMin - event.startMin);
  // Clamp the start so the whole block stays inside the day, then snap to grid.
  const maxStart = MINUTES_PER_DAY - duration;
  const rawStart = Math.min(Math.max(0, event.startMin + delta.minDelta), Math.max(0, maxStart));
  const startMin = snapMinutes(rawStart);
  const endMin = Math.min(MINUTES_PER_DAY, startMin + duration);
  return { ...event, date, startMin, endMin, updatedAt: Date.now() };
}
