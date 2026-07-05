// Time helpers for the calendar, against the CalendarEvent model. Successor
// to lib/scheduleTime.ts (which served the old Mon-Fri planner): minutes from
// local midnight everywhere, 12h am/pm for display.

import type { CalendarEvent } from "./types";

export const MINUTES_PER_DAY = 1440;
export const SNAP_MIN = 15;
export const MIN_DURATION_MIN = 5;
export const DEFAULT_DURATION_MIN = 30;

// Default visible window — a camp day of ~8:00-18:00 covers drop-off through
// pickup. The window auto-extends (to the hour) around any event outside it.
export const DAY_START_MIN = 8 * 60;
export const DAY_END_MIN = 18 * 60;
// Where tap-to-place starts scanning — the real start of camp programming.
export const DEFAULT_PLANNING_START_MIN = 9 * 60;

// Longest sensible single activity: it has to fit inside one camp day.
export const MAX_ACTIVITY_DURATION_MIN = DAY_END_MIN - DAY_START_MIN;

// Lengths the editor offers — 15-minute steps only, so every committed block
// ends on the same grid the calendar snaps to. A 20-min length starting at 1:15
// would end at 1:35, the exact off-grid time we never want to be selectable.
// Kept exported for back-compat; the live ladder is now snap-aware via
// durationOptionsFor (this is exactly durationOptionsFor(15)).
export const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120];

// The length ladder for a given snap grid. Every entry is a MULTIPLE of the snap
// so a block committed at any snapped start still ends on the grid — the same
// invariant DURATION_OPTIONS holds for 15. Curated (not just "every multiple") so
// the dropdown stays a short, sensible list: fine steps near the short end, then
// coarser jumps toward two hours. An unknown snap falls back to the 15 ladder.
export function durationOptionsFor(snap: number): number[] {
  switch (snap) {
    case 5:
      return [5, 10, 15, 20, 30, 45, 60, 75, 90, 120];
    case 10:
      return [10, 20, 30, 40, 50, 60, 90, 120];
    case 30:
      return [30, 60, 90, 120];
    case 15:
    default:
      return [15, 30, 45, 60, 75, 90, 120];
  }
}

// A snap grid as a FullCalendar duration string — 15 -> "00:15:00" — for the
// snapDuration prop. Kept beside minutesToTimeString (which serves the absolute
// clock props) because a snap is a DURATION, not a time of day: it can exceed a
// day boundary conceptually, though every real snap is well under an hour.
export function snapDurationString(snap: number): string {
  const safe = Math.max(1, Math.round(snap));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":00";
}

// 540 -> "9:00 am"; hourOnly drops ":00" for axis-style labels.
export function formatClock(min: number, hourOnly = false): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(min)));
  const total = clamped % MINUTES_PER_DAY;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  if (hourOnly && m === 0) return h12 + " " + suffix;
  return h12 + ":" + String(m).padStart(2, "0") + " " + suffix;
}

export function formatRangeLabel(startMin: number, endMin: number): string {
  return formatClock(startMin) + " – " + formatClock(endMin);
}

// "45 min", "1 hr", "1 hr 15 min" — humanized duration for pickers.
export function formatDuration(min: number): string {
  const safe = Math.max(0, Math.round(min));
  if (safe < 60) return safe + " min";
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m ? h + " hr " + m + " min" : h + " hr";
}

export function snapMinutes(min: number, snap: number = SNAP_MIN): number {
  return Math.round(min / snap) * snap;
}

// A duration forced onto the snap grid, never shorter than one slot — so an
// activity's recommended length (which can be any number of minutes) becomes a
// block whose end lands on the grid, not at an off-grid time like 1:35.
export function snapDurationMin(min: number): number {
  return Math.max(SNAP_MIN, snapMinutes(min));
}

// 540 -> "09:00:00" (FullCalendar slotMinTime/slotMaxTime/scrollTime format).
export function minutesToTimeString(min: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":00";
}

export function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export type DayWindow = { startMin: number; endMin: number };

// The configured window (camp hours, defaulting to the classic 8:00–18:00
// band) unioned with event extents, floored/ceiled to the hour, so an imported
// or synced 7:15 am event renders instead of clipping. The base only ever
// extends outward — the user's chosen hours are never narrowed by this.
export function effectiveWindow(
  events: CalendarEvent[],
  base: DayWindow = { startMin: DAY_START_MIN, endMin: DAY_END_MIN }
): DayWindow {
  let startMin = base.startMin;
  let endMin = base.endMin;
  for (const event of events) {
    if (event.allDay) continue;
    if (event.startMin < startMin) startMin = Math.max(0, Math.floor(event.startMin / 60) * 60);
    if (event.endMin > endMin) endMin = Math.min(MINUTES_PER_DAY, Math.ceil(event.endMin / 60) * 60);
  }
  return { startMin, endMin };
}

// First free start that fits `durationMin` among a day's timed events,
// scanning the snap grid from `notBeforeMin`, then earlier slots as fallback.
export function nextFreeStartForDay(
  dayEvents: CalendarEvent[],
  durationMin: number,
  notBeforeMin: number = DEFAULT_PLANNING_START_MIN,
  window: DayWindow = { startMin: DAY_START_MIN, endMin: DAY_END_MIN }
): number | null {
  if (!Number.isFinite(durationMin)) return null;
  const duration = Math.max(MIN_DURATION_MIN, Math.round(durationMin));
  if (duration > window.endMin - window.startMin) return null;

  const busy = dayEvents
    .filter((event) => !event.allDay)
    .map((event) => ({ start: event.startMin, end: event.endMin }))
    .sort((a, b) => a.start - b.start);

  const latestStart = window.endMin - duration;
  const preferredFrom = Math.max(window.startMin, snapMinutes(notBeforeMin));
  const starts: number[] = [];
  for (let start = preferredFrom; start <= latestStart; start += SNAP_MIN) starts.push(start);
  for (let start = window.startMin; start < preferredFrom && start <= latestStart; start += SNAP_MIN) {
    starts.push(start);
  }

  for (const start of starts) {
    const end = start + duration;
    const overlaps = busy.some((b) => start < b.end && end > b.start);
    if (!overlaps) return start;
  }
  return null;
}
