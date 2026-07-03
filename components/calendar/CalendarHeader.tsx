"use client";

import { type ReactNode } from "react";
import { CampIcon } from "../icons";
import { ViewSwitch } from "./ViewSwitch";
import type { ViewKey } from "@/lib/calendar/views";

// Our own chrome instead of FullCalendar's headerToolbar, so the calendar's
// frame is the app's design system — laid out like Notion Calendar: the date
// title on the left, then a right cluster of the view switch and the Add button.
// The [Day | Week | Month] switch is the same seg-slide the Library uses for
// Shelf/Deck/Catalog, so the two views' top bars match. There's no prev/next
// pager — navigation is the sidebar mini-month (and horizontal scroll), which
// also hosts the Today jump on desktop; the header keeps a Today button only on
// mobile, where the mini-month isn't rendered (CSS hides it from 768px up). View
// SETTINGS (weekends, week-start, days, camp hours) live in the sidebar on
// desktop and behind the settings button → a sheet on mobile. Keyboard (wired in
// CalendarShell): 1/0/2–9 + d/w/m views, t today, j/k + arrows navigate.
export function CalendarHeader({
  title,
  view,
  todayInView,
  onView,
  onToday,
  onOpenSettings,
  onAdd,
  actions,
  colorLens,
}: {
  title: string;
  view: ViewKey;
  todayInView: boolean;
  onView: (view: ViewKey) => void;
  onToday: () => void;
  /** Opens the view-settings sheet on mobile (desktop surfaces them in the rail). */
  onOpenSettings: () => void;
  /** Opens the event composer (QuickAdd) — the green Add button, like the Library. */
  onAdd: () => void;
  /** Camp-scoped actions composed by CampApp (the Subscribe / .ics feed pill);
   *  sits at the head of the controls cluster as a peer to the view switch. */
  actions?: ReactNode;
  /** The active "Color by" lens label ("Location", "Rating"…) when the calendar
   *  is coloring by a COMPUTED axis rather than stored per-event colors. Both
   *  render in the same visual language, so this pill is the one cue declaring
   *  "these colors are a lens, not your paint". Absent in custom mode. */
  colorLens?: string;
}) {
  return (
    <div className="calhead">
      <h2 className="calhead__title">{title}</h2>
      {colorLens && (
        <span className="calhead__lens" title={"Cards are colored by " + colorLens.toLowerCase() + " — event colors are not shown"}>
          By {colorLens.toLowerCase()}
        </span>
      )}
      <div className="calhead__controls">
        {actions}
        <ViewSwitch view={view} onView={onView} />
        {/* Today is mobile-only here — desktop's lives in the sidebar mini-month
            (CSS hides this from the 768px sidebar breakpoint up). */}
        <button
          type="button"
          className="btn btn--quiet calhead__today"
          onClick={onToday}
          disabled={todayInView}
          title={todayInView ? "You're looking at today" : "Jump to today (t)"}
        >
          Today
        </button>
        <button
          type="button"
          className="calhead__settings"
          onClick={onOpenSettings}
          aria-label="View settings"
          title="View settings"
        >
          <CampIcon.More />
        </button>
        {/* The green Add — the calendar's twin of the Library's Add button.
            Desktop-only; phones keep the FAB (the header is tight there). */}
        <button
          type="button"
          className="btn btn--primary calhead__add"
          onClick={onAdd}
          title="Add to calendar"
        >
          <CampIcon.Plus />
          <span>Add</span>
        </button>
      </div>
    </div>
  );
}
