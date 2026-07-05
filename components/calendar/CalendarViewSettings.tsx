"use client";

import type { ReactNode } from "react";
import { CampIcon } from "../icons";
import { MiniSeg, ToggleSwitch } from "../primitives";
import { Select } from "../floating/Select";
import { isNDaysView, type ViewKey, type WeekStart } from "@/lib/calendar/views";
import type { ColorMode } from "@/lib/content/data";
import { DaysStepper } from "./DaysStepper";
import { useDeviceShape } from "../useDeviceShape";

// The "Color by" choices, in resolver order. Labels read in the View ledger's
// quiet voice; the ids are the ColorMode union (lib/data).
const COLOR_BY_OPTIONS: { value: ColorMode; label: string }[] = [
  { value: "custom", label: "Custom" },
  { value: "type", label: "Activity type" },
  { value: "rating", label: "Rating" },
  { value: "location", label: "Location" },
  { value: "theme", label: "Theme" },
];

// The calendar's view settings — a switch ledger in the Library filter vocabulary,
// so the two views' sidebars read as one. Weather is a SEPARATE settings group
// (see WeatherSettings), folded under its own sibling toggle, not nested here.
// Every value lives in CalendarShell, so the desktop rail and the mobile sheet
// share one source of truth and never drift.

export function CalendarViewSettings({
  view,
  colorMode,
  onColorMode,
  shadeWeekendsOn,
  onToggleShadeWeekends,
  weekStart,
  onWeekStart,
  onChangeView,
  onOpenCamps,
  subscribeControl,
}: {
  view: ViewKey;
  colorMode: ColorMode;
  onColorMode: (mode: ColorMode) => void;
  shadeWeekendsOn: boolean;
  onToggleShadeWeekends: () => void;
  weekStart: WeekStart;
  onWeekStart: (start: WeekStart) => void;
  onChangeView: (v: ViewKey) => void;
  onOpenCamps: () => void;
  /** The calendar's .ics feed trigger (SubscribeFeedButton) — the ledger's
   *  final row, control-only (its own popover). Undefined when signed out
   *  (no feed to subscribe to), so the row doesn't render at all. */
  subscribeControl?: ReactNode;
}) {
  // The Days control belongs to Week: Day/Week/N-days are the same timed strip at
  // a different day count, so it appears only while a multi-day window is active
  // and sets how many days it spans (2–9; 7 = the full Week). Day and Month have
  // no day-count, so the row is hidden there — and the header switch shows Week
  // for any N-day count, so what's active is never ambiguous.
  const isMultiDay = view === "timeGridWeek" || isNDaysView(view);
  const dayCount = isNDaysView(view) ? view.n : 7;
  // Desktop has its own sidebar "Camps" section (below the calendar rail) as the
  // ONE entry point into the camp manager, so this row is redundant there. It
  // stays for phone/tablet, where the rail doesn't render and this settings
  // sheet is camps' only way in.
  const { isDesktop } = useDeviceShape();

  return (
    <div className="ledger calset">
      <div className="ledger__row">
        <span className="ledger__label"><CampIcon.Palette className="ledger__ic" />Color by</span>
        <Select
          value={colorMode}
          options={COLOR_BY_OPTIONS}
          onChange={onColorMode}
          ariaLabel="Color events by"
        />
      </div>
      <div className="ledger__row">
        <span className="ledger__label"><CampIcon.Calendar className="ledger__ic" />Shade weekends</span>
        <ToggleSwitch
          on={shadeWeekendsOn}
          onChange={() => onToggleShadeWeekends()}
          ariaLabel="Shade weekends"
        />
      </div>
      <div className="ledger__row">
        <span className="ledger__label"><CampIcon.Calendar className="ledger__ic" />Week starts</span>
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
          <span className="ledger__label"><CampIcon.Calendar className="ledger__ic" />Days</span>
          <DaysStepper
            value={dayCount}
            onChange={(n) => onChangeView(n === 7 ? "timeGridWeek" : { type: "ndays", n })}
          />
        </div>
      )}
      {/* Camp hours moved onto the camp object — they're now edited per camp in
          the camp manager. On desktop that manager is reached from the sidebar's
          own "Camps" section, so this row is desktop-only redundant; phone/tablet
          have no rail, so it stays here as their one way in. */}
      {!isDesktop && (
        <button type="button" className="ledger__row calset__rowbtn" onClick={onOpenCamps}>
          <span className="ledger__label"><CampIcon.Home className="ledger__ic" />Manage camps</span>
          <span className="calset__rowval" aria-hidden="true">
            <CampIcon.ChevronRight />
          </span>
        </button>
      )}
      {/* Subscribe (the .ics feed control) — the ledger's final row, camp-
          scoped like everything above it. One mount here reaches both desktop
          (rail) and mobile (settings sheet), since both render this ledger. */}
      {subscribeControl && (
        <div className="ledger__row">
          <span className="ledger__label"><CampIcon.Calendar className="ledger__ic" />Subscribe</span>
          {subscribeControl}
        </div>
      )}
    </div>
  );
}
