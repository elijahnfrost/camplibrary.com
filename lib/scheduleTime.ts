// Camp Library — schedule time helpers.
// The planner now displays a full 24-hour military-time day. The parser still
// accepts the original camp clock values so saved schedules keep working.

import type { ScheduleBlock } from "./types";

// Visible window for the planner grid (minutes from midnight).
export const DAY_START_MIN = 0;
export const DAY_END_MIN = 24 * 60;
export const TOTAL_MIN = DAY_END_MIN - DAY_START_MIN;

// Drag snapping + sensible default durations.
export const SNAP_MIN = 15;
export const DEFAULT_DURATION_MIN = 30;
export const MIN_DURATION_MIN = 5;
export const DEFAULT_PLANNING_START_MIN = 8 * 60;

function parseCampMinutes(time: string): number | null {
  const match = (time || "").match(/^(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = Math.max(0, Math.min(59, match[2] ? parseInt(match[2], 10) : 0));
  if (hour > 0 && hour < 6) hour += 12; // Legacy 1-5 o'clock are afternoon at camp.
  if (hour === 24) return minute === 0 ? DAY_END_MIN : DAY_END_MIN - 1;
  hour = Math.max(0, Math.min(23, hour));
  return hour * 60 + minute;
}

// "13:30" -> 810. Legacy camp times like "1:30" still mean 13:30.
export function campMinutes(time: string): number {
  return parseCampMinutes(time) ?? DAY_END_MIN;
}

// 540 -> "09:00", 810 -> "13:30", 720 -> "12:00".
export function minutesToCamp(total: number): string {
  const clamped = Math.max(0, Math.min(DAY_END_MIN, Math.round(total)));
  if (clamped === DAY_END_MIN) return "24:00";
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
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

export function blockDuration(block: ScheduleBlock): number {
  return blockEndMin(block) - blockStartMin(block);
}

// "09:00 - 09:45" style range for display.
export function formatRange(startMin: number, endMin: number): string {
  return minutesToCamp(startMin) + " - " + minutesToCamp(endMin);
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return minutes + " min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? h + "h " + m + "m" : h + "h";
}

// Hour marks for the calendar axis (00:00, 01:00 ... 24:00).
export function hourMarks(): { min: number; label: string }[] {
  const marks: { min: number; label: string }[] = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 60) {
    marks.push({ min: m, label: minutesToCamp(m) });
  }
  return marks;
}

// 15-minute start options across the visible window, for the composer dropdown.
export function startOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += SNAP_MIN) {
    const camp = minutesToCamp(m);
    options.push({ value: camp, label: camp });
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
  for (let start = DAY_START_MIN; start + durationMin <= DAY_END_MIN; start += SNAP_MIN) {
    const end = start + durationMin;
    const overlaps = busy.some((b) => start < b.end && end > b.start);
    if (!overlaps) return start;
  }
  // Nothing free — stack it at the end of the day so it is still reachable.
  return Math.max(DAY_START_MIN, DAY_END_MIN - durationMin);
}
