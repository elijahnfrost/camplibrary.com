"use client";

import type { ReactNode } from "react";
import { CampIcon } from "../icons";

export type CalendarViewId = "timeGridDay" | "timeGridWeek" | "dayGridMonth";

const VIEW_LABELS: { id: CalendarViewId; label: string }[] = [
  { id: "timeGridDay", label: "Day" },
  { id: "timeGridWeek", label: "Week" },
  { id: "dayGridMonth", label: "Month" },
];

// Our own chrome instead of FullCalendar's headerToolbar, so the calendar's
// frame is the app's design system. Keyboard: t / d / w / m / arrows (wired
// in CalendarShell).
export function CalendarHeader({
  title,
  view,
  todayInView,
  onView,
  onToday,
  onPrev,
  onNext,
  actions,
}: {
  title: string;
  view: CalendarViewId;
  todayInView: boolean;
  onView: (view: CalendarViewId) => void;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** Rendered at the right edge (e.g. the auth pill). */
  actions?: ReactNode;
}) {
  return (
    <div className="calhead">
      <div className="calhead__nav">
        <button
          type="button"
          className="btn btn--quiet calhead__today"
          onClick={onToday}
          disabled={todayInView}
          title={todayInView ? "You're looking at today" : "Jump to today (t)"}
        >
          Today
        </button>
        <button type="button" className="icon-btn" onClick={onPrev} aria-label="Previous" title="Previous (←)">
          <CampIcon.ChevronLeft />
        </button>
        <button type="button" className="icon-btn" onClick={onNext} aria-label="Next" title="Next (→)">
          <CampIcon.ChevronRight />
        </button>
        <h2 className="calhead__title">{title}</h2>
      </div>
      <div className="calhead__views" role="group" aria-label="Calendar view">
        {VIEW_LABELS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={"calhead__view" + (view === item.id ? " is-active" : "")}
            aria-pressed={view === item.id}
            onClick={() => onView(item.id)}
            title={item.label + " view (" + item.label[0].toLowerCase() + ")"}
          >
            {item.label}
          </button>
        ))}
      </div>
      {actions && <div className="calhead__actions">{actions}</div>}
    </div>
  );
}
