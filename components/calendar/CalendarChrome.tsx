"use client";

// ============================================================
// Camp Library — Calendar chrome (shell sub-components)
//
// Presentational sub-components rendered by CalendarShell: the pin / edited /
// kit / backup-umbrella glyphs, the bulk location + skip-days pickers, and the
// gather + rain review panels. Extracted verbatim from CalendarShell.tsx
// (structural cleanup, no behavior change).
// ============================================================
import { useRef, useState } from "react";
import type {
  DateSelectArg,
  DayHeaderContentArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventMountArg,
} from "@fullcalendar/core";
import type { DateClickArg, EventReceiveArg, EventResizeDoneArg } from "@fullcalendar/interaction";
import { fromFcDates, healEvent, splitDayLegLabels, toFcEvent, type AlternatesGlyph } from "@/lib/calendar/adapter";
import { hasRainAlternate, planPromote, resolveAlternates } from "@/lib/activity/alternates";
import { type RainPlan } from "@/lib/calendar/rainPlan";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import {
  clampNDays,
  DEFAULT_WEEK_START,
  isNDaysView,
  parseStoredView,
  parseWeekStart,
  viewTitle,
  type StoredViewPref,
  type ViewKey,
  type WeekStart,
} from "@/lib/calendar/views";
import {
  formatClock,
} from "@/lib/calendar/time";
import { campSnapMin, resolveDayWindow, type Camp } from "@/lib/content/camps";
import { guideBandsForRange, type GuideBand } from "@/lib/calendar/guides";
import { catalogNameFor, type Material } from "@/lib/materials/materialCatalog";
import { coverage } from "@/lib/materials/materials";
import type { StockState } from "@/lib/materials/kitStock";
import {
  type DayKit,
  type DayKitItem,
} from "@/lib/calendar/kitConflicts";
import { categoryTint, eventTint, isColorMode, type ColorMode } from "@/lib/content/data";
import {
  type AlternateRef,
  type CalendarEvent,
  type DateKey,
} from "@/lib/calendar/types";
import { groupStops, stopEventIds, type CalendarStop } from "@/lib/calendar/stops";
import {
  applyMoveDelta,
  moveDelta,
  orderEventIds,
  rangeSelection,
} from "@/lib/calendar/selection";
import {
  applyCustomStamp,
  buildSeriesEvents,
  eventsInSeries,
  planBulkSeriesRemovals,
  planOccurrenceEdit,
  planResetOccurrence,
  planRestoreOccurrence,
  planSeriesDelete,
  planSeriesEdit,
  planSeriesSkip,
  planSeriesSkipMany,
  recurrenceDates,
  rulesEqual,
  type RecurrenceRule,
  type SeriesScope,
  type SeriesTemplate,
} from "@/lib/calendar/recurrence";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../ui/icons";
import { FloatingLayer } from "../floating/FloatingLayer";
import { StockDot } from "../materials/StockDot";
import { LocationPickerList } from "../floating/LocationField";
import { WeatherPopover, type WeatherPopoverTarget } from "./WeatherPopover";
import {
  conditionLabel,
  forecastCoverage,
  formatTemp,
  parseTempUnit,
  parseWeatherLocation,
  parseWeatherMode,
  parseWeatherRange,
  weatherGlyphSvg,
  HISTORY_PAST_DAYS,
  WEATHER_RANGE_DAYS,
  type TempUnit,
  type WeatherLocation,
  type WeatherMode,
  type WeatherRange,
} from "@/lib/weather";
import { QuickAdd, draftFromEvent, type EditorDraft } from "./QuickAdd";
import { ShiftBar, type ShiftBarTarget } from "./ShiftBar";

// The timed Day/Week/N-day views are a rolling, day-aligned strip (dateAlignment
// "day"), so they list consecutive days from wherever you've scrolled and never
// snap to a week boundary — FullCalendar's firstDay is inert for them. We still
// hand FC a value while the strip is mounted; Month is the one view whose column
// order honours the configurable "Start week on" pref (weekStart). The sidebar
// mini-month is a month grid too, so it reads the same pref.

// A small inline pushpin, shared by the "Pin in place" / "Unpin" menu item and
// the pinned-event card glyph. CampIcon.Pin is the location MAP-pin (semantically
// wrong for holding an event in place), and icons.tsx is owned elsewhere, so the
// pushpin is inlined here on the shared 24×24 stroke grid the icon set uses
// (currentColor via CSS).
export function PinInPlaceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z" />
      <path d="M12 17v3" />
    </svg>
  );
}

// A tiny "edited" tick — a small pencil — worn by a "this"-customized series
// member's card beside the repeat loop. Inlined on the icon set's 24×24 stroke
// grid (icons.tsx is owned elsewhere), tone from the card's own color.
export function EditedTickGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M14 6l4 4L9 19l-4 1 1-4 8-9z" />
    </svg>
  );
}

// The Gather chip's glyph — a small supply crate/basket standing for the day's
// kit. Inlined on the icon set's 24×24 grid (icons.tsx is owned elsewhere), the
// same convention the pin glyph uses. Tone comes from the chip's own color, so
// this is a plain currentColor outline.
export function KitGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M4 9h16l-1.2 9.5a1 1 0 0 1-1 .9H6.2a1 1 0 0 1-1-.9L4 9z" />
      <path d="M8.5 9 12 4.5 15.5 9" />
      <path d="M9.5 12.5v3.5M14.5 12.5v3.5" />
    </svg>
  );
}

// The backup-plan glyph on a rain-reason placement — a small umbrella, on the
// CampIcon 24×24 line grid (icons.tsx is owned elsewhere, so it's inlined here).
export function BackupUmbrellaGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M12 3v2M4 12a8 8 0 0 1 16 0z" />
      <path d="M12 12v6a2.2 2.2 0 0 1-4.4 0" />
    </svg>
  );
}

// The bulk Location… picker body: owns a working set so the toggled rows stay
// checked while the menu is open (the popover doesn't unmount between toggles),
// and re-applies the whole set across the selection on each toggle — a REPLACE,
// matching the merged multi-location model. Starts empty (a bulk apply has no
// single "current" value across a heterogeneous set; the first pick is the
// authoritative new set).
export function BulkLocationPicker({
  options,
  onApply,
  onManage,
}: {
  options: readonly string[];
  onApply: (locations: string[]) => void;
  onManage: () => void;
}) {
  const [working, setWorking] = useState<string[]>([]);
  return (
    <LocationPickerList
      value={working}
      options={options}
      onChange={(locations) => {
        setWorking(locations);
        onApply(locations);
      }}
      onManage={onManage}
    />
  );
}

// The "Skip days…" picker body: the series' upcoming occurrence dates as toggle
// chips, a live summary line ("adds N skips, computed now"), and a Skip button.
// Owns its own working set so toggles stay checked while the card is open; commits
// once on Skip. The dates come from the concrete rows (computed by the caller), so
// this is display-only over a known list.
export function SkipDaysPicker({
  dates,
  onSkip,
  onClose,
}: {
  dates: DateKey[];
  onSkip: (dates: DateKey[]) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<ReadonlySet<DateKey>>(() => new Set());
  const toggle = (date: DateKey) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  const count = chosen.size;
  return (
    <div className="cal-skipdays__body">
      <h3 className="cal-skipdays__title">Skip days</h3>
      <div className="cal-skipdays__chips" role="group" aria-label="Upcoming occurrences">
        {dates.map((date) => {
          const on = chosen.has(date);
          return (
            <button
              key={date}
              type="button"
              className={"cal-skipdays__chip" + (on ? " is-on" : "")}
              aria-pressed={on}
              onClick={() => toggle(date)}
            >
              {formatEventDateLabel(date)}
            </button>
          );
        })}
      </div>
      <p className="cal-skipdays__summary" role="status">
        {count ? "Adds " + count + (count === 1 ? " skip" : " skips") + ", computed now" : "Pick days to skip"}
      </p>
      <div className="cal-skipdays__foot">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!count}
          onClick={() => onSkip([...chosen])}
        >
          Skip {count || ""}
        </button>
      </div>
    </div>
  );
}

// The Gather popover — the day's kit at a glance. Hard conflicts pin on top (two
// overlapping blocks fighting over one item, each with a "We have several" action
// that marks the material `plenty`); then the gather list, one row per needed
// material with its coverage glyph and, for staff, an inline Have/Low/Out seg —
// the explicit picker, not a cycling tap (this popover IS a FloatingLayer, so it
// can't nest a ContextMenu the way the run-sheet's chip menu does; see
// FloatingLayer.tsx's no-nested-layers note). Rides the shared .cal-popover
// floating surface (rect-anchored on desktop, bottom-docked on phones,
// scroll-closes) like the weather + stop cards.
export function GatherPopover({
  date,
  day,
  anchor,
  stock,
  catalog,
  events,
  canEdit,
  onSetStock,
  onMarkPlenty,
  onClose,
}: {
  date: DateKey;
  day: DayKit;
  anchor: DOMRect;
  stock: Record<string, StockState>;
  catalog?: Material[];
  events: Record<string, CalendarEvent>;
  /** Staff session — read-only sessions see the list inert (no seg / no action). */
  canEdit: boolean;
  onSetStock?: (id: string, state: StockState) => void;
  onMarkPlenty?: (id: string, label: string) => void;
  onClose: () => void;
}) {
  // A short "10:00 Parachute Games" label for an event in a conflict, in the
  // blocks' own order (dayKit already sorts eventIds chronologically).
  const eventLabel = (id: string): string => {
    const event = events[id];
    if (!event) return "a block";
    return formatClock(event.startMin) + " " + (event.title || "block");
  };

  return (
    <FloatingLayer
      anchor={{ kind: "rect", rect: anchor }}
      onClose={onClose}
      className="cal-popover cal-gather"
      role="dialog"
      ariaLabel={"Gather — " + formatEventDateLabel(date)}
    >
      <div className="cal-popover__head">
        <div className="cal-popover__heading">
          <h3 className="cal-popover__title">Gather</h3>
          <p className="cal-popover__when">{formatEventDateLabel(date)}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CampIcon.Close />
        </button>
      </div>

      {day.hardConflicts.length > 0 && (
        <ul className="cal-gather__conflicts">
          {day.hardConflicts.map((conflict) => (
            <li key={conflict.id} className="cal-gather__conflict">
              <div className="cal-gather__conflict-body">
                <span className="cal-gather__conflict-title">
                  {conflict.label} — needed by {conflict.eventIds.length} overlapping blocks
                </span>
                <span className="cal-gather__conflict-blocks">
                  {conflict.eventIds.map(eventLabel).join(" · ")}
                </span>
              </div>
              {canEdit && onMarkPlenty && (
                <button
                  type="button"
                  className="btn btn--quiet btn--sm cal-gather__plenty"
                  onClick={() => onMarkPlenty(conflict.id, conflict.label)}
                >
                  We have several
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ul className="cal-gather__list">
        {day.items.map((item) => (
          <GatherRow
            key={item.id}
            item={item}
            catalog={catalog}
            canEdit={canEdit}
            current={stock[item.id]}
            onSetStock={onSetStock ? (state) => onSetStock(item.id, state) : undefined}
          />
        ))}
      </ul>
    </FloatingLayer>
  );
}

// PREP rank: fewer materials / lower prep first (a rainy-day fallback should be
// quick to swap in). None < Low < Medium < High.
const PREP_RANK: Record<string, number> = { None: 0, Low: 1, Medium: 2, High: 3 };

// Rank library activities as rain backups for an at-risk block. The pool is
// everything the camp CAN run indoors (place Inside or Both) minus the block's own
// activity; the order is: has-been-used-before (appears anywhere in `events`),
// then coverage-ready (kit on hand via the stock/catalog lens), then low-prep,
// then same-type as the outdoor block (the fresh-account fallback — no history, no
// stock — still surfaces a like-for-like swap first), then title. Pure + capped so
// the picker stays a short, sensible list.
function rankBackupSuggestions(
  outdoor: Activity | undefined,
  activities: Activity[],
  events: Record<string, CalendarEvent>,
  stock: Record<string, StockState>,
  catalog: Material[] | undefined,
  limit = 8
): Activity[] {
  const used = new Set<string>();
  for (const event of Object.values(events)) {
    if (event.activityId) used.add(event.activityId);
  }
  const stockKnown = Object.keys(stock).length > 0;
  const pool = activities.filter(
    (a) => (a.place === "Inside" || a.place === "Both") && a.id !== outdoor?.id
  );
  const scored = pool.map((a) => {
    const ready = stockKnown ? coverage(a, stock, catalog).state === "ready" : false;
    return {
      activity: a,
      usedBefore: used.has(a.id),
      ready,
      prep: PREP_RANK[a.prep] ?? 1,
      sameType: outdoor ? a.type === outdoor.type : false,
    };
  });
  scored.sort(
    (x, y) =>
      Number(y.usedBefore) - Number(x.usedBefore) ||
      Number(y.ready) - Number(x.ready) ||
      x.prep - y.prep ||
      Number(y.sameType) - Number(x.sameType) ||
      x.activity.title.localeCompare(y.activity.title)
  );
  return scored.slice(0, limit).map((s) => s.activity);
}

// One gather-list row. For staff the leading glyph IS the bloom dot (StockDot,
// the one stock control app-wide): the row rests as status; tapping the dot
// blooms the explicit Have/Low/Out choices in place. Inline DOM, so it nests
// happily inside this FloatingLayer popover. A read-only session (or no writer
// wired) keeps the plain typographic glyph row.
function GatherRow({
  item,
  catalog,
  canEdit,
  current,
  onSetStock,
}: {
  item: DayKitItem;
  catalog?: Material[];
  canEdit: boolean;
  current: StockState | undefined;
  onSetStock?: (state: StockState) => void;
}) {
  const glyph =
    item.status === "have"
      ? "✓"
      : item.status === "substituted"
        ? "↔"
        : item.status === "low"
          ? "◑"
          : item.status === "out"
            ? "✕"
            : "•"; // missing
  const statusText =
    item.status === "have"
      ? "on hand"
      : item.status === "substituted"
        ? "via " + (item.viaId ? catalogNameFor(catalog, item.viaId) : "substitute")
        : item.status === "low"
          ? "low"
          : item.status === "out"
            ? "out"
            : "missing";
  const interactive = canEdit && Boolean(onSetStock);
  if (!interactive) {
    return (
      <li className="cal-gather__row cal-gather__row--static">
        <span className={"cal-gather__glyph cal-gather__glyph--" + item.status} aria-hidden="true">
          {glyph}
        </span>
        <span className="cal-gather__name">{item.label}</span>
        <span className="cal-gather__status">{statusText}</span>
      </li>
    );
  }
  // The dot's resting face mirrors the row's day-status (via reads as covered);
  // the bloom highlights the item's OWN recorded state, so fixing a "missing"
  // row is one tap on the dot + one on a choice.
  const display =
    item.status === "substituted" ? ("via" as const) : item.status === "missing" ? current : item.status;
  return (
    <li className="cal-gather__row">
      <StockDot
        name={item.label}
        display={display}
        current={current}
        onSet={(state) => onSetStock?.(state)}
      />
      <span className="cal-gather__name">{item.label}</span>
      <span className="cal-gather__status">{statusText}</span>
    </li>
  );
}

// The Rain Review panel (click a day-header's rain lens) — the day's at-risk
// outdoor blocks and their backup plans in one place, anchored at the chip like
// the Gather / weather cards. A row with a backup shows a [Swap] button; a row
// with none shows [Pick backup…], which opens a ranked library picker. The footer
// carries the batch "Switch all N", a "Shift day…" handoff, and "Dismiss for
// today". Never auto-mutates; every action is staff-gated upstream.
export function RainPanel({
  date,
  plan,
  anchor,
  byId,
  onPromote,
  onPickBackup,
  onSwitchAll,
  onShiftDay,
  onDismiss,
  onClose,
  activities,
  events,
  stock,
  catalog,
}: {
  date: DateKey;
  plan: RainPlan;
  anchor: DOMRect;
  byId: Record<string, Activity>;
  onPromote: (event: CalendarEvent, index: number) => void;
  onPickBackup: (event: CalendarEvent, alt: AlternateRef) => void;
  onSwitchAll: () => void;
  onShiftDay: (anchorRect: DOMRect) => void;
  onDismiss: () => void;
  onClose: () => void;
  activities: Activity[];
  events: Record<string, CalendarEvent>;
  stock: Record<string, StockState>;
  catalog?: Material[];
}) {
  const footRef = useRef<HTMLDivElement | null>(null);
  // The row whose "Pick backup…" picker is open (an event id), plus the ranked
  // library suggestions — computed lazily when a picker opens.
  const [picking, setPicking] = useState<string | null>(null);

  const switchableCount = plan.rows.filter((r) => r.alternates.length).length;

  return (
    <FloatingLayer
      anchor={{ kind: "rect", rect: anchor }}
      onClose={onClose}
      className="cal-popover cal-rain"
      role="dialog"
      ariaLabel={"Rain review — " + formatEventDateLabel(date)}
    >
      <div className="cal-popover__head">
        <div className="cal-popover__heading">
          <h3 className="cal-popover__title">
            <BackupUmbrellaGlyph className="cal-rain__title-glyph" />
            {Math.round(plan.probMax)}% rain
          </h3>
          <p className="cal-popover__when">
            {formatEventDateLabel(date)} · {plan.rows.length} outdoor block
            {plan.rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CampIcon.Close />
        </button>
      </div>

      <ul className="cal-rain__list">
        {plan.rows.map((row) => {
          const hasBackup = row.alternates.length > 0;
          const first = row.alternates[0];
          return (
            <li key={row.event.id} className="cal-rain__row">
              <div className="cal-rain__body">
                <span className="cal-rain__when">{formatClock(row.event.startMin)}</span>
                <span className="cal-rain__title">{row.event.title || "block"}</span>
                {hasBackup && (
                  <span className="cal-rain__arrow" aria-hidden="true">
                    →
                  </span>
                )}
                {hasBackup && <span className="cal-rain__alt">{first.title}</span>}
              </div>
              {hasBackup ? (
                <button
                  type="button"
                  className="btn btn--quiet btn--sm cal-rain__swap"
                  onClick={() => onPromote(row.event, 0)}
                >
                  Swap
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--quiet btn--sm cal-rain__pick"
                  onClick={() => setPicking((id) => (id === row.event.id ? null : row.event.id))}
                  aria-expanded={picking === row.event.id}
                >
                  Pick backup…
                </button>
              )}
              {picking === row.event.id && !hasBackup && (
                <RainBackupPicker
                  suggestions={rankBackupSuggestions(
                    row.event.activityId ? byId[row.event.activityId] : undefined,
                    activities,
                    events,
                    stock,
                    catalog
                  )}
                  onPick={(activity) => {
                    onPickBackup(row.event, { title: activity.title, activityId: activity.id, reason: "rain" });
                    setPicking(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>

      <div className="cal-rain__foot" ref={footRef}>
        {switchableCount > 0 && (
          <button type="button" className="btn btn--primary btn--sm cal-rain__all" onClick={onSwitchAll}>
            Switch all {switchableCount}
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--sm cal-rain__shift"
          onClick={() => {
            const rect = footRef.current?.getBoundingClientRect() ?? anchor;
            onShiftDay(rect);
          }}
        >
          <CampIcon.Clock />
          Shift day…
        </button>
        <button type="button" className="btn btn--ghost btn--sm cal-rain__dismiss" onClick={onDismiss}>
          Dismiss for today
        </button>
      </div>
    </FloatingLayer>
  );
}

// The ranked library picker under a "Pick backup…" row — the top indoor-runnable
// candidates for an outdoor block, ordered by rankBackupSuggestions. Tapping one
// writes it as the block's rain backup (the parent then offers Swap).
function RainBackupPicker({
  suggestions,
  onPick,
}: {
  suggestions: Activity[];
  onPick: (activity: Activity) => void;
}) {
  if (!suggestions.length) {
    return <p className="cal-rain__empty">No indoor activities in the library yet.</p>;
  }
  return (
    <ul className="cal-rain__picker">
      {suggestions.map((a) => (
        <li key={a.id}>
          <button type="button" className="cal-rain__pickopt" onClick={() => onPick(a)}>
            <span className="cal-rain__pickname">{a.title}</span>
            <span className="cal-rain__pickmeta">
              {a.type}
              {a.place === "Both" ? " · in/out" : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
