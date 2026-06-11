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

export const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120];

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

export function snapMinutes(min: number, snap: number = SNAP_MIN): number {
  return Math.round(min / snap) * snap;
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

// The configured window unioned with event extents, floored/ceiled to the
// hour, so an imported or synced 7:15 am event renders instead of clipping.
export function effectiveWindow(events: CalendarEvent[]): DayWindow {
  let startMin = DAY_START_MIN;
  let endMin = DAY_END_MIN;
  for (const event of events) {
    if (event.allDay) continue;
    if (event.startMin < startMin) startMin = Math.max(0, Math.floor(event.startMin / 60) * 60);
    if (event.endMin > endMin) endMin = Math.min(MINUTES_PER_DAY, Math.ceil(event.endMin / 60) * 60);
  }
  return { startMin, endMin };
}

// 15-minute start options across a window, for the editor's start dropdown.
export function startOptions(window: DayWindow): { value: number; label: string }[] {
  const options: { value: number; label: string }[] = [];
  for (let m = window.startMin; m < window.endMin; m += SNAP_MIN) {
    options.push({ value: m, label: formatClock(m) });
  }
  return options;
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
