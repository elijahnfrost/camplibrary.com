// CalendarEvent ↔ FullCalendar conversion. FullCalendar speaks local Date
// objects; storage speaks DateKey + minutes. The conversion happens only at
// this boundary, so neither the backend nor the store ever sees FC types.

import type { EventInput } from "@fullcalendar/core";
import { categoryTint } from "@/lib/data";
import type { Activity } from "@/lib/types";
import { fromDateKey, minutesOfDay, toDateKey } from "./dates";
import { MIN_DURATION_MIN, MINUTES_PER_DAY } from "./time";
import type { CalendarEvent } from "./types";

export type ActivityIndex = Record<string, Activity>;

// Stale activity refs (the activity was deleted) self-heal on read: the event
// survives as a custom event carrying its denormalized title.
export function healEvent(event: CalendarEvent, byId: ActivityIndex): CalendarEvent {
  if (!event.activityId || byId[event.activityId]) return event;
  const healed: CalendarEvent = { ...event, kind: "custom" };
  delete healed.activityId;
  return healed;
}

export function toFcEvent(event: CalendarEvent, byId: ActivityIndex): EventInput {
  const activity = event.activityId ? byId[event.activityId] : undefined;
  const title = activity?.title || event.title || "Untitled";
  const tint = categoryTint(activity?.type);
  const dayStart = fromDateKey(event.date);

  const base: EventInput = {
    id: event.id,
    title,
    extendedProps: {
      calendarEvent: event,
      activityId: activity ? event.activityId : undefined,
      tint,
      categoryLabel: activity?.type,
    },
  };

  if (event.allDay) {
    return { ...base, start: dayStart, allDay: true };
  }
  return {
    ...base,
    start: new Date(dayStart.getTime() + event.startMin * 60_000),
    end: new Date(dayStart.getTime() + event.endMin * 60_000),
    allDay: false,
  };
}

// Rebuild a CalendarEvent from FullCalendar's post-drag/resize Dates. The end
// is measured from the start's local midnight and clamped to that day, so a
// drag to the bottom edge can't produce an out-of-bounds event.
export function fromFcDates(
  start: Date,
  end: Date | null,
  allDay: boolean,
  previous: CalendarEvent
): CalendarEvent {
  const date = toDateKey(start);
  if (allDay) {
    return { ...previous, date, startMin: 0, endMin: 0, allDay: true, updatedAt: Date.now() };
  }
  const startMin = minutesOfDay(start);
  const dayStart = fromDateKey(date);
  const duration = previous.allDay
    ? Math.max(MIN_DURATION_MIN, 30)
    : Math.max(MIN_DURATION_MIN, previous.endMin - previous.startMin);
  const rawEndMin = end ? Math.round((end.getTime() - dayStart.getTime()) / 60_000) : startMin + duration;
  const endMin = Math.max(startMin + MIN_DURATION_MIN, Math.min(MINUTES_PER_DAY, rawEndMin));
  const next: CalendarEvent = { ...previous, date, startMin, endMin, updatedAt: Date.now() };
  delete next.allDay;
  return next;
}
