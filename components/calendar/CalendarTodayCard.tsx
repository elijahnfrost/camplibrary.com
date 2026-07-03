"use client";

// The calendar rail's "Today" card — the operator's Now/Next glance, moved here
// from the retired Home tab. A compact card at the TOP of the calendar sidebar
// (above the mini-month) showing the block underway and the one up next; the
// week's shape is already the mini-month's job, so nothing else lives here.
// Read-only and link-only: an activity-backed row opens the viewer.

import { type CSSProperties } from "react";
import type { CalendarEvent } from "@/lib/calendar/types";
import { useTodayNowNext } from "@/lib/calendar/nowNext";
import { formatClockCompact } from "@/lib/calendar/time";
import { durLabel, effectiveEventColor } from "@/lib/data";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../icons";

// Short display labels for the meal-flagged event indicator — trivially derived
// from the kebab-case MealKind values already on the event.
const MEAL_KIND_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  "am-snack": "AM Snack",
  lunch: "Lunch",
  "pm-snack": "PM Snack",
  other: "Meal",
};

// One Now/Next row: time + title with the same 3px category spine (--cal-tint)
// the calendar rail, catalog rows, and placed event cards use. Activity-backed
// rows open the viewer; plain events don't.
function NowNextRow({
  event,
  activity,
  status,
  onOpen,
}: {
  event: CalendarEvent;
  activity: Activity | null;
  status: "now" | "next";
  onOpen?: (activity: Activity, event: CalendarEvent) => void;
}) {
  const tint = activity ? effectiveEventColor(event, activity) : event.color ?? "var(--line)";
  const time = event.allDay ? "All day" : formatClockCompact(event.startMin);
  const meta = activity ? activity.type + " · " + durLabel(activity) : "Custom block";
  const mealLabel = event.mealKind ? MEAL_KIND_LABEL[event.mealKind] ?? "Meal" : null;
  const body = (
    <>
      <span className={"caltoday__badge caltoday__badge--" + status}>{status === "now" ? "Now" : "Next"}</span>
      <span className="caltoday__main">
        <span className="caltoday__title">{event.title || (activity ? activity.title : "Untitled")}</span>
        <span className="caltoday__meta">
          <span className="caltoday__time">{time}</span>
          {meta}
          {mealLabel && <span className="caltoday__meal">{mealLabel}</span>}
        </span>
      </span>
    </>
  );
  if (activity && onOpen) {
    return (
      <button
        type="button"
        className="caltoday__row caltoday__row--link"
        style={{ "--cal-tint": tint } as CSSProperties}
        onClick={() => onOpen(activity, event)}
      >
        {body}
      </button>
    );
  }
  return (
    <div className="caltoday__row" style={{ "--cal-tint": tint } as CSSProperties}>
      {body}
    </div>
  );
}

export function CalendarTodayCard({
  events,
  byId,
  onOpenActivity,
}: {
  events: Record<string, CalendarEvent>;
  byId: Record<string, Activity>;
  /** Open the viewer from a Now/Next row (carries event date/time context). */
  onOpenActivity?: (activity: Activity, event: CalendarEvent) => void;
}) {
  const { todaysEvents, nowEventId, nextEventId } = useTodayNowNext(events);
  const nowEvent = nowEventId ? todaysEvents.find((e) => e.id === nowEventId) ?? null : null;
  const nextEvent = nextEventId ? todaysEvents.find((e) => e.id === nextEventId) ?? null : null;

  const rows: { event: CalendarEvent; status: "now" | "next" }[] = [];
  if (nowEvent) rows.push({ event: nowEvent, status: "now" });
  if (nextEvent) rows.push({ event: nextEvent, status: "next" });

  return (
    <div className="sidesection sidesection--fixed caltoday">
      <div className="sidesection__head caltoday__head">
        <span className="sidesection__title">Today</span>
      </div>
      <div className="sidesection__body caltoday__body">
        {rows.length > 0 ? (
          rows.map(({ event, status }) => (
            <NowNextRow
              key={event.id}
              event={event}
              activity={event.activityId ? byId[event.activityId] ?? null : null}
              status={status}
              onOpen={onOpenActivity}
            />
          ))
        ) : (
          <p className="caltoday__empty">
            <CampIcon.Calendar className="caltoday__emptyic" />
            {todaysEvents.length > 0 ? "Nothing running right now." : "Nothing planned today."}
          </p>
        )}
      </div>
    </div>
  );
}
