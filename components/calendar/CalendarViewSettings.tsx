"use client";

import { CampIcon } from "../icons";
import { MiniSeg, ToggleSwitch } from "../primitives";
import { isNDaysView, type ViewKey, type WeekStart } from "@/lib/calendar/views";
import { DaysStepper } from "./DaysStepper";

// The calendar's view settings, persistently visible in the sidebar "View"
// section (and the mobile settings sheet) — a switch ledger in the Library
// filter vocabulary, so the two views' sidebars read as one. Every value lives
// in CalendarShell, so the two mounts share one source of truth and never drift.

export function CalendarViewSettings({
  view,
  shadeWeekendsOn,
  onToggleShadeWeekends,
  weekStart,
  onWeekStart,
  onChangeView,
  onOpenHours,
  onOpenCamps,
}: {
  view: ViewKey;
  shadeWeekendsOn: boolean;
  onToggleShadeWeekends: () => void;
  weekStart: WeekStart;
  onWeekStart: (start: WeekStart) => void;
  onChangeView: (v: ViewKey) => void;
  onOpenHours: () => void;
  onOpenCamps: () => void;
}) {
  // The Days control belongs to Week: Day/Week/N-days are the same timed strip at
  // a different day count, so it appears only while a multi-day window is active
  // and sets how many days it spans (2–9; 7 = the full Week). Day and Month have
  // no day-count, so the row is hidden there — and the header switch shows Week
  // for any N-day count, so what's active is never ambiguous.
  const isMultiDay = view === "timeGridWeek" || isNDaysView(view);
  const dayCount = isNDaysView(view) ? view.n : 7;
  return (
    <div className="ledger calset">
      <div className="ledger__row">
        <span className="ledger__label">Shade weekends</span>
        <ToggleSwitch
          on={shadeWeekendsOn}
          onChange={() => onToggleShadeWeekends()}
          ariaLabel="Shade weekends"
        />
      </div>
      <div className="ledger__row">
        <span className="ledger__label">Week starts</span>
        <MiniSeg
          ariaLabel="Start week on"
          value={String(weekStart)}
          onChange={(v) => onWeekStart(Number(v) as WeekStart)}
          options={[
            { id: "0", label: "Sun", ariaLabel: "Sunday" },
            { id: "1", label: "Mon", ariaLabel: "Monday" },
          ]}
        />
      </div>
      {isMultiDay && (
        <div className="ledger__row">
          <span className="ledger__label">Days</span>
          <DaysStepper
            value={dayCount}
            onChange={(n) => onChangeView(n === 7 ? "timeGridWeek" : { type: "ndays", n })}
          />
        </div>
      )}
      <button type="button" className="ledger__row calset__rowbtn" onClick={onOpenHours}>
        <span className="ledger__label">Camp hours</span>
        <span className="calset__rowval" aria-hidden="true">
          <CampIcon.Clock />
        </span>
      </button>
      <button type="button" className="ledger__row calset__rowbtn" onClick={onOpenCamps}>
        <span className="ledger__label">Manage camps</span>
        <span className="calset__rowval" aria-hidden="true">
          <CampIcon.ChevronRight />
        </span>
      </button>
    </div>
  );
}
