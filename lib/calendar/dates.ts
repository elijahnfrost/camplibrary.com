// Zero-dependency local date math for DateKeys ("YYYY-MM-DD"). Everything
// goes through new Date(y, m-1, d) local-time arithmetic — no ISO string
// parsing, so no UTC/DST drift on a camp's wall-clock schedule.

import type { DateKey } from "./types";

export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toDateKey(date: Date): DateKey {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

export function todayKey(): DateKey {
  return toDateKey(new Date());
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

// The local-midnight start of the week containing `date`, where `firstDay` is
// the week's first weekday (0 = Sunday, 1 = Monday — the calendar's default).
// Used to snap the rolling week view and mini-calendar picks onto a whole week.
export function startOfWeek(date: Date, firstDay = 1): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() - firstDay + 7) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

// Whole-day span between two DateKeys (end exclusive), e.g. a 7-day week → 7.
export function daySpan(start: DateKey, end: DateKey): number {
  return Math.round((fromDateKey(end).getTime() - fromDateKey(start).getTime()) / 86_400_000);
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

// "Wednesday · Jun 11" — the event-context chip shown in the activity viewer.
export function formatEventDateLabel(key: DateKey): string {
  const date = fromDateKey(key);
  const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
  const monthDay = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return weekday + " · " + monthDay;
}
