// Reminder placement heuristic — the "clicking between two events reads as a
// reminder" rule, kept pure so it's unit-tested in isolation (CalendarShell only
// wires it to the date-click). A reminder is a no-time (0-min) marker, so a tap
// squeezed into a tight gap between two events — where no block would fit — is
// almost certainly a reminder. This only picks the DEFAULT length (0 = reminder);
// the editor still lets you give it a duration.

import type { CalendarEvent } from "./types";
import { DEFAULT_DURATION_MIN } from "./time";

// The widest gap between two events that still reads as "no room for a block".
// One default block (30 min): a gap that could hold a real activity isn't tight.
const REMINDER_GAP_MAX_MIN = DEFAULT_DURATION_MIN;

// Does a tap at `atMin` on `dateKey` land in a TIGHT gap squeezed between two
// timed events — one ending at/before it, one starting at/after it, with only a
// small gap between them? A tap inside an event, or in open space (unbounded on
// a side, e.g. before the first event or after the last), returns false.
// 0-min reminders + all-day events are ignored when measuring the gap.
export function isTightGapBetweenEvents(
  events: CalendarEvent[],
  dateKey: string,
  atMin: number,
  maxGapMin: number = REMINDER_GAP_MAX_MIN
): boolean {
  let before = -Infinity; // latest event end at/before the tap
  let after = Infinity; // earliest event start at/after the tap
  for (const e of events) {
    if (e.date !== dateKey || e.allDay || e.endMin === e.startMin) continue;
    if (atMin >= e.startMin && atMin < e.endMin) return false; // inside an event
    if (e.endMin <= atMin && e.endMin > before) before = e.endMin;
    if (e.startMin >= atMin && e.startMin < after) after = e.startMin;
  }
  if (before === -Infinity || after === Infinity) return false; // not bounded both sides
  return after - before <= maxGapMin;
}
