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
