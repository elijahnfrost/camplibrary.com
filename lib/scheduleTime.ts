// Camp Library — schedule time helpers.
// The planner shows a BOUNDED camp-day window (not a full 24h grid), so the
// real programming day fills the viewport instead of forcing long scrolls.
// Times are stored as zero-padded 24h "HH:MM" but displayed in 12h am/pm.

import type { ScheduleBlock } from "./types";

// Visible window for the planner grid (minutes from midnight). A camp day of
// ~8:00–18:00 covers drop-off through pickup without showing dead overnight hours.
export const DAY_START_MIN = 8 * 60; // 8:00
export const DAY_END_MIN = 18 * 60; // 18:00
export const TOTAL_MIN = DAY_END_MIN - DAY_START_MIN;

// Absolute bounds for parsing/formatting safety (independent of the visible window).
const ABS_MAX_MIN = 24 * 60;

// Drag snapping + sensible default durations.
export const SNAP_MIN = 15;
export const DEFAULT_DURATION_MIN = 30;
export const MIN_DURATION_MIN = 5;
// Where quick-add / "Add event" default to — the real start of camp programming.
export const DEFAULT_PLANNING_START_MIN = 9 * 60;

// Calendar zoom: the timeline scale is the pixel height of one hour. Pinch /
// ctrl-wheel / zoom buttons step through these levels; the chosen index is
// persisted (localStorage "planZoom").
export const ZOOM_LEVELS = [40, 52, 64, 76, 96, 120, 160]; // px per hour
export const DEFAULT_ZOOM = 4; // 96px — readable 15-minute snack blocks in a full 8-6 day
export const DESKTOP_ZOOM = 3; // 76px — a roomier default on wide screens
export function clampZoomIndex(index: number): number {
  return Math.max(0, Math.min(ZOOM_LEVELS.length - 1, Math.round(index)));
}

// Overlapping-event column caps. Beyond the cap we collapse the tail into a
// single "+N more" chip so a busy slot never shreds into unreadable slivers.
export const MAX_COLS_DAY = 3;
export const MAX_COLS_WEEK = 2;

// A blank-grid pointer drag only becomes a "draw new event" gesture once it
// travels past this many pixels (raised on coarse pointers); below it, the
// press is treated as a tap that opens the composer at that time.
export const DRAW_THRESHOLD_PX = 6;

function parseCampMinutes(time: string): number | null {
  const match = (time || "").match(/^(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;
  const hourText = match[1];
  let hour = parseInt(hourText, 10);
  const minute = Math.max(0, Math.min(59, match[2] ? parseInt(match[2], 10) : 0));
  if (hourText.length === 1 && hour > 0 && hour < 6) {
    hour += 12; // Legacy unpadded 1-5 o'clock are afternoon at camp.
  }
  if (hour === 24) return minute === 0 ? ABS_MAX_MIN : ABS_MAX_MIN - 1;
  hour = Math.max(0, Math.min(23, hour));
  return hour * 60 + minute;
}

// "13:30" -> 810. Legacy camp times like "1:30" still mean 13:30.
export function campMinutes(time: string): number {
  return parseCampMinutes(time) ?? DEFAULT_PLANNING_START_MIN;
}

// 540 -> "09:00", 810 -> "13:30". Storage stays 24h, zero-padded.
export function minutesToCamp(total: number): string {
  const clamped = Math.max(0, Math.min(ABS_MAX_MIN, Math.round(total)));
  if (clamped === ABS_MAX_MIN) return "24:00";
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// Rewrite any stored/legacy time string into canonical zero-padded 24h.
export function normalizeTimeString(raw: string): string {
  return minutesToCamp(campMinutes(raw));
}

// 12-hour display for a US camp audience. Accepts minutes or an "HH:MM" string.
// 540 -> "9:00 am", 810 -> "1:30 pm". `hourOnly` drops ":00" for axis ticks.
export function formatClock(value: number | string, hourOnly = false): string {
  const min = typeof value === "number" ? value : campMinutes(value);
  const clamped = Math.max(0, Math.min(ABS_MAX_MIN, Math.round(min)));
  const total = clamped % ABS_MAX_MIN; // 24:00 reads as 12:00 am edge
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  if (hourOnly && m === 0) return h12 + " " + suffix;
  return h12 + ":" + String(m).padStart(2, "0") + " " + suffix;
}

export function snapMinutes(min: number, snap: number = SNAP_MIN): number {
  return Math.round(min / snap) * snap;
}

export function clampStart(min: number, durationMin: number): number {
  return Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - durationMin, min));
}

export function blockStartMin(block: ScheduleBlock): number {
  return parseCampMinutes(block.start) ?? DEFAULT_PLANNING_START_MIN;
}

export function blockEndMin(block: ScheduleBlock): number {
  const start = blockStartMin(block);
  const end = block.end ? parseCampMinutes(block.end) : start + DEFAULT_DURATION_MIN;
  if (end == null) return start + DEFAULT_DURATION_MIN;
  return end > start ? end : start + DEFAULT_DURATION_MIN;
}

// "9:00 am – 9:45 am" style range for display.
export function formatRange(startMin: number, endMin: number): string {
  return formatClock(startMin) + " – " + formatClock(endMin);
}

// Hour marks for the calendar axis across the visible window.
export function hourMarks(): { min: number; label: string }[] {
  const marks: { min: number; label: string }[] = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 60) {
    marks.push({ min: m, label: formatClock(m, true) });
  }
  return marks;
}

// 15-minute start options across the visible window, for the composer dropdown.
// Value stays 24h "HH:MM" (storage); label is 12h am/pm.
export function startOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += SNAP_MIN) {
    options.push({ value: minutesToCamp(m), label: formatClock(m) });
  }
  return options;
}

export const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120];

// Find the first free start time that fits `durationMin`, scanning the day on the snap grid.
export function nextFreeStart(blocks: ScheduleBlock[], durationMin: number): number {
  const busy = blocks
    .map((b) => ({ start: blockStartMin(b), end: blockEndMin(b) }))
    .sort((a, b) => a.start - b.start);
  const searchRanges = [
    [DEFAULT_PLANNING_START_MIN, DAY_END_MIN],
    [DAY_START_MIN, DEFAULT_PLANNING_START_MIN],
  ] as const;
  for (const [from, to] of searchRanges) {
    for (let start = from; start + durationMin <= to; start += SNAP_MIN) {
      const end = start + durationMin;
      const overlaps = busy.some((b) => start < b.end && end > b.start);
      if (!overlaps) return start;
    }
  }
  // Nothing free in the window — append right after the last block so the new
  // event stays near the visible day rather than dropping into dead hours.
  const lastEnd = busy.length ? Math.max(...busy.map((b) => b.end)) : DAY_START_MIN;
  return clampStart(snapMinutes(lastEnd), durationMin);
}
