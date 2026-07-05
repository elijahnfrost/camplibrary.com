// Camp Library — the Rain Review planner.
//
// A pure lens over one day: given the day's weather roll-up, the day's events,
// and a threshold, decide whether rain is likely and which OUTDOOR blocks are at
// risk — so the calendar can surface a "70% rain — 3 outdoor blocks" review and
// offer each block's backup plans in one place.
//
// Deterministic: no Date.now, no I/O. The trigger reads only the DayWeather the
// forecast already produced (precipProbMax + condition), so a test can pin it.

import type { DayWeather } from "../weather";
import { resolveAlternates } from "../alternates";
import type { Activity } from "../types";
import type { AlternateRef, CalendarEvent, DateKey } from "./types";

// One at-risk row: the outdoor event and the backup plans it resolves to (the
// activity default unless the placement overrides). An empty `alternates` means
// "no backup on file" — the UI offers a "Pick backup…" affordance for it.
interface RainRow {
  event: CalendarEvent;
  alternates: AlternateRef[];
}

export interface RainPlan {
  /** The day's max rain probability (%), for the "N% rain" headline. */
  probMax: number;
  /** The at-risk outdoor blocks, chronological. Never empty (null is returned
   *  instead when nothing is at risk). */
  rows: RainRow[];
}

// The trigger: rain is "likely" when the day's max precip probability meets the
// threshold, OR the day's condition is a thunderstorm (a storm can carry a lower
// posted probability but still cancels outdoor play — see wmoToCondition).
function rainLikely(day: DayWeather, thresholdPct: number): boolean {
  return day.precipProbMax >= thresholdPct || day.condition === "thunder";
}

// Whether an event is an at-risk OUTDOOR block: an activity-backed, timed,
// non-reminder, non-all-day placement whose activity is played Outside. Meals,
// indoor/both activities, reminders, all-day banners, and custom (no-activity)
// blocks are all excluded — they don't get rained out the way an outdoor game
// does.
function isAtRiskOutdoor(event: CalendarEvent, activity: Activity | undefined): boolean {
  if (event.kind !== "activity" || !activity) return false;
  if (activity.place !== "Outside") return false;
  if (event.allDay) return false;
  // A 0-min "reminder" (start === end) is a marker, not a runnable block.
  if (event.endMin === event.startMin) return false;
  return true;
}

// Plan the Rain Review for one day. Returns null when the day has no forecast,
// rain isn't likely, or nothing outdoor is at risk (the panel renders nothing).
// Rows are ordered chronologically (start, then id as a stable tiebreak), each
// carrying its resolved backup list.
export function rainPlanForDay(
  dateKey: DateKey,
  dayWeather: DayWeather | undefined,
  events: CalendarEvent[],
  byId: Record<string, Activity>,
  thresholdPct: number
): RainPlan | null {
  if (!dayWeather) return null;
  if (!rainLikely(dayWeather, thresholdPct)) return null;

  const atRisk = events.filter((event) => {
    if (event.date !== dateKey) return false;
    const activity = event.activityId ? byId[event.activityId] : undefined;
    return isAtRiskOutdoor(event, activity);
  });
  if (!atRisk.length) return null;

  atRisk.sort((a, b) => a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const rows: RainRow[] = atRisk.map((event) => ({
    event,
    alternates: resolveAlternates(event, event.activityId ? byId[event.activityId] : undefined),
  }));

  return { probMax: dayWeather.precipProbMax, rows };
}
