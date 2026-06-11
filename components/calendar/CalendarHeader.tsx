"use client";

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
  onView,
  onToday,
  onPrev,
  onNext,
}: {
  title: string;
  view: CalendarViewId;
  onView: (view: CalendarViewId) => void;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="calhead">
      <div className="calhead__nav">
        <button type="button" className="btn btn--quiet calhead__today" onClick={onToday} title="Jump to today (t)">
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
    </div>
  );
}
