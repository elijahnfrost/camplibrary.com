"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
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
import { hasRainAlternate, planPromote, resolveAlternates } from "@/lib/alternates";
import { rainPlanForDay, type RainPlan } from "@/lib/calendar/rainPlan";
import {
  addDays,
  daySpan,
  formatEventDateLabel,
  fromDateKey,
  minutesOfDay,
  toDateKey,
  todayKey,
} from "@/lib/calendar/dates";
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
  DEFAULT_DURATION_MIN,
  DEFAULT_PLANNING_START_MIN,
  MINUTES_PER_DAY,
  SNAP_MIN,
  effectiveWindow,
  formatClock,
  minutesToTimeString,
  nextFreeStartForDay,
  nowMinutes,
  snapDurationMin,
  snapDurationString,
  snapMinutes,
  type DayWindow,
} from "@/lib/calendar/time";
import { campSnapMin, resolveDayWindow, type Camp } from "@/lib/camps";
import { guideBandsForRange, type GuideBand } from "@/lib/calendar/guides";
import type { ThemeResolver } from "@/lib/calendar/adapter";
import { catalogNameFor, type Material } from "@/lib/materialCatalog";
import { coverage } from "@/lib/materials";
import type { StockState } from "@/lib/kitStock";
import {
  conflictsForEvent,
  dayKit,
  type DayKit,
  type DayKitItem,
  type KitConflict,
} from "@/lib/calendar/kitConflicts";
import { categoryTint, eventTint, isColorMode, type ColorMode } from "@/lib/data";
import {
  isDateKey,
  normalizeCalendarEvent,
  type AlternateRef,
  type CalendarEvent,
  type DateKey,
} from "@/lib/calendar/types";
import { isTightGapBetweenEvents } from "@/lib/calendar/reminderPlacement";
import { groupStops, stopEventIds, type CalendarStop } from "@/lib/calendar/stops";
import { yToMinutes } from "@/lib/calendar/dragTime";
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
import { useLocalStorage } from "@/lib/store";
import { CampIcon } from "../icons";
import { Modal } from "../Modal";
import { ContextMenu } from "../floating/ContextMenu";
import { FloatingLayer } from "../floating/FloatingLayer";
import { StockDot } from "../StockDot";
import { ColorPickerBody } from "../floating/ColorField";
import { LocationPickerList } from "../floating/LocationField";
import { hasOpenDialog } from "../useDialogFocus";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarViewSettings } from "./CalendarViewSettings";
import { WeatherSettings } from "./WeatherSettings";
import { StopPopover } from "./StopPopover";
import { WeatherPopover, type WeatherPopoverTarget } from "./WeatherPopover";
import { WeatherGlyph } from "./WeatherGlyph";
import { useWeatherForecast } from "./useWeatherForecast";
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
import { CalendarRail } from "./CalendarRail";
import { SeriesScopeDialog } from "./SeriesScopeDialog";
import { ShiftBar, type ShiftBarTarget } from "./ShiftBar";

// The timed Day/Week/N-day views are a rolling, day-aligned strip (dateAlignment
// "day"), so they list consecutive days from wherever you've scrolled and never
// snap to a week boundary — FullCalendar's firstDay is inert for them. We still
// hand FC a value while the strip is mounted; Month is the one view whose column
// order honours the configurable "Start week on" pref (weekStart). The sidebar
// mini-month is a month grid too, so it reads the same pref.
const STRIP_FIRST_DAY = 1;

// The timed views (Day / Week / Number-of-days) are ONE continuous, day-aligned
// strip you scroll horizontally — fixed-width day columns, native momentum, and
// CSS scroll-snap that loosely aligns to the nearest day so a day is never left
// half cut off at the edge (the free equivalent of the premium scrollgrid's
// dayMinWidth). Day/Week/N just set the ZOOM: how many days are sized to fit the
// viewport (1 / 7 / N) — which then determines the day width. We render a wide
// strip (STRIP_DAYS) and re-anchor it as you scroll near either end so the scroll
// feels endless. Month stays its own grid.
const STRIP_DAYS = 35;
// Re-anchor when the visible window comes within this many days of a strip edge,
// recentering the strip by this much so there's always runway to keep scrolling.
const REANCHOR_MARGIN = 4;
const REANCHOR_SHIFT = 14;
// A day column never narrows past this (so a 9-day zoom on a phone stays legible
// and simply overflows / scrolls instead of crushing the columns).
const MIN_DAY_WIDTH = 84;

// Pinch-to-zoom for the timed grid's HOUR HEIGHT (the vertical analogue of the
// Day/Week/N horizontal day-width zoom). A trackpad/touch pinch — or ctrl+wheel —
// scales the base 15-min slot height via the --cal-slot-zoom CSS var (see
// calendar.css). 1 = default; above 1 stretches each hour taller for fine detail.
// SLOT_ZOOM_MAX caps the zoom-IN; the zoom-OUT minimum is DYNAMIC (computeMinZoom)
// — you can never shrink the day past the point where it fills the viewport, so the
// grid is always hard-blocked top-and-bottom with no blank space below the last
// hour. SLOT_ZOOM_FLOOR is only an absolute sanity bound for the stored value.
const SLOT_ZOOM_MAX = 3;
const SLOT_ZOOM_FLOOR = 0.2;
const clampSlotZoom = (zoom: number) =>
  Math.min(SLOT_ZOOM_MAX, Math.max(SLOT_ZOOM_FLOOR, zoom));

const CALENDAR_VIEWS = {
  timeGridStrip: {
    type: "timeGrid",
    duration: { days: STRIP_DAYS },
    dateAlignment: "day",
    dateIncrement: { days: 1 },
  },
};

// The FullCalendar view-type string for a ViewKey: every timed view is the one
// scrollable strip; only Month is its own grid.
function fcType(view: ViewKey): string {
  return view === "dayGridMonth" ? "dayGridMonth" : "timeGridStrip";
}

// How many days the chosen view sizes to fit the viewport (the zoom level).
function targetDaysFor(view: ViewKey): number {
  if (isNDaysView(view)) return clampNDays(view.n);
  if (view === "timeGridDay") return 1;
  return 7; // Week (Month doesn't use the strip)
}

// The right-click context menu opens over EITHER one event (the single-event
// menu) or a whole multi-selection (the bulk menu) — chosen by onGridContextMenu
// from whether the right-clicked event is part of a >1 selection. Both variants
// render through the same ContextMenu at the cursor point.
type MenuState =
  | { kind: "single"; event: CalendarEvent; point: { x: number; y: number } }
  | { kind: "bulk"; ids: string[]; point: { x: number; y: number } }
  // An empty-slot right-click inside a timed day column: one item that opens the
  // day-shift card at the clicked date + minute.
  | { kind: "shift"; date: DateKey; cutoffMin: number; point: { x: number; y: number } };
// A bulk Color… / Location… menu item opens its picker cursor-anchored at the
// same point (the floating-picker pattern), carrying the ids it acts on.
type BulkPickerState =
  | { kind: "color"; ids: string[]; point: { x: number; y: number } }
  | { kind: "location"; ids: string[]; point: { x: number; y: number } };

// A non-undo toast button (label + click). The escalation wave needs a toast to
// carry MORE than one — "Moved this Tue only · [All] [Following]" — so the toast
// holds an ordered `actions` array. The legacy single `action` is still accepted
// and folded into that array (compat for the existing "Save to library" caller),
// so migration is additive.
type ToastAction = { label: string; onClick: () => void };
type ToastState = {
  message: string;
  onUndo?: () => void;
  /** Legacy single action (e.g. "Save to library" after a one-off). Folded into
   *  `actions` at render — kept so existing call sites need no change. */
  action?: ToastAction;
  /** Ordered escalation / secondary actions rendered before Undo. */
  actions?: ToastAction[];
};
// Editing or deleting one occurrence of a repeating event first asks the scope
// (this / following / all). The pending action is held here until the user picks.
type ScopePrompt =
  | { mode: "edit"; event: CalendarEvent; draft: EditorDraft }
  | { mode: "delete"; event: CalendarEvent };

// A bulk edit's TOUCHED fields only ("leave unchanged unless touched"): a field
// is present iff the panel actually changed it. color uses `undefined` to mean
// "clear", and locations uses an empty array to mean "clear" (vs the key absent
// = "leave"), so presence is checked with `in`.
export type BulkEditChanges = {
  color?: string | undefined;
  locations?: string[];
  allDay?: boolean;
  dayShift?: number;
  minShift?: number;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

// The end minute for a draft: 0 for all-day; EQUAL to start for a 0-min reminder
// (length 0, which renders as a dot marker, never a block); otherwise start + the
// snapped length, clamped to the end of the day.
function endMinForDraft(startMin: number, durationMin: number, allDay: boolean): number {
  if (allDay) return 0;
  if (durationMin <= 0) return startMin;
  return Math.min(MINUTES_PER_DAY, startMin + snapDurationMin(durationMin));
}

// A key-order-independent JSON serializer (recurses into nested objects, keeps
// array order). Used for the escalation staleness fingerprint below.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

// A CANONICAL fingerprint of a stored row for the escalation staleness check:
// stableStringify of every field except `updatedAt` (the last-write-wins clock,
// which a re-commit always bumps). BOTH sides are re-normalized first, because the
// `expected` rows are the raw plan output while the live rows were rebuilt by
// normalizeCalendarEvent on commit (which may drop empty/absent fields and reorder
// keys) — passing both through the same normalizer makes the comparison apples-to-
// apples, so a value the this-commit wrote reads as unchanged and escalation stays
// enabled. A row that fails to normalize (shouldn't happen for a stored row)
// fingerprints as its raw self.
function rowFingerprint(event: CalendarEvent): string {
  const normalized = normalizeCalendarEvent(event) ?? event;
  const { updatedAt: _updatedAt, ...rest } = normalized;
  return stableStringify(rest);
}

const boolStorage = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const slotZoomStorage = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? clampSlotZoom(value) : fallback;

// Validate the stored "Color by" mode against the known ids (mirrors
// parseWeekStart/boolStorage) so a stale/garbage value falls back to "custom".
const colorModeStorage = (value: unknown, fallback: ColorMode) =>
  isColorMode(value) ? value : fallback;

// The Rain-alert threshold (percent). 0 = off; 30/50/70 arm the rain-review lens
// when the day's precip probability meets it. A closed whitelist so a garbage
// stored value falls back cleanly (mirrors the other weather-pref validators).
export type RainThreshold = 0 | 30 | 50 | 70;
const RAIN_THRESHOLDS: readonly RainThreshold[] = [0, 30, 50, 70];
const parseRainThreshold = (value: unknown, fallback: RainThreshold): RainThreshold =>
  typeof value === "number" && (RAIN_THRESHOLDS as readonly number[]).includes(value)
    ? (value as RainThreshold)
    : fallback;
const RAIN_THRESHOLD_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Off" },
  { value: "30", label: "30%" },
  { value: "50", label: "50%" },
  { value: "70", label: "70%" },
];

// Validate the dismissed-Rain-Review list: keep only well-formed DateKeys that are
// still today-or-later (a stale past date is pruned so the list can't grow across a
// season). Deterministic per read; mirrors the other localStorage validators.
const parseDismissedRainDays = (value: unknown, fallback: DateKey[]): DateKey[] => {
  if (!Array.isArray(value)) return fallback;
  const today = todayKey();
  return [...new Set(value.filter((v): v is DateKey => isDateKey(v) && v >= today))];
};

export function CalendarShell({
  events,
  upsertEvent,
  removeEvent,
  upsertEvents,
  removeEvents,
  commitEvents,
  undo,
  redo,
  activities,
  byId,
  canEdit,
  requireStaff,
  onOpenActivity,
  announce,
  railSlot,
  onOpenCamps,
  locationOptions,
  locationColors,
  onManageLocations,
  onCreateActivity,
  dayWindow,
  activeCamp,
  guides = [],
  subscribeControl,
  themeOf,
  kitStock = {},
  materialCatalog,
  setStockState,
  markPlenty,
  onReady,
}: {
  events: Record<string, CalendarEvent>;
  upsertEvent: (event: CalendarEvent) => void;
  removeEvent: (id: string) => void;
  /** Atomic batch writes for recurring-series create/edit/delete (see
   *  lib/cloudStore) — one render and one undo step for the whole series. */
  upsertEvents: (events: CalendarEvent[]) => void;
  removeEvents: (ids: string[]) => void;
  /** Atomic upsert+delete — a scoped series edit regenerates some occurrences and
   *  removes others as ONE undo step (and stamps the active camp like the others). */
  commitEvents: (upserts: CalendarEvent[], removes: string[]) => void;
  /** Calendar undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z). Each returns whether
   *  anything moved, so the shortcut can announce the result. */
  undo: () => boolean;
  redo: () => boolean;
  activities: Activity[];
  byId: Record<string, Activity>;
  canEdit: boolean;
  requireStaff: (action: string) => boolean;
  onOpenActivity: (activity: Activity, eventContext: CalendarEvent) => void;
  announce: (message: string) => void;
  /** Desktop: the left-sidebar slot the mini-month + View settings render into
   *  (one sidebar shared with the Library tab's filters). Null on mobile. */
  railSlot?: HTMLElement | null;
  /** Opens the camp manager (add / switch / rename / delete + per-camp hours).
   *  Lives in the sidebar's View settings, so the header has no camp pill. */
  onOpenCamps: () => void;
  /** The user-editable place vocabulary offered by every Location picker (the
   *  event editor and the bulk context-menu picker share this list). */
  locationOptions: readonly string[];
  /** Per-location color overrides (place label → hex). Used by the "Color by →
   *  Location" mode so a recolored place (e.g. a yellow Gym) paints through. */
  locationColors: Record<string, string>;
  /** Opens the location manager (add / rename / remove places) from a picker's
   *  "Manage locations…" footer. */
  onManageLocations: () => void;
  /** Create a brand-new library activity from a typed name + length (the create
   *  bar's "Save to library" path) and return it so the new event links to it.
   *  Lands in the Routine bucket; null if the staff gate blocks it. */
  onCreateActivity: (title: string, durationMin: number) => Activity | null;
  /** The base visible window (drop-off → pickup) of the active camp, or the
   *  classic 8:00–18:00 band when no camp is active. effectiveWindow only ever
   *  stretches this outward around events. Computed by CampApp from the active
   *  camp's hours, which now live on the (synced) camp object. */
  dayWindow: DayWindow;
  /** The active camp itself — the source of per-day hours (resolveDayWindow, for
   *  the union window + closed-day shading) and the snap grid (campSnapMin). Null
   *  when no camp is active, in which case every day uses the classic 8:00–18:00
   *  band and the default 15-min snap (identical to today's behavior). */
  activeCamp: Camp | null;
  /** The guidance bands (soft, recurring day-structure frames). Expanded over the
   *  rendered strip into FullCalendar background events. Empty = none drawn. */
  guides?: GuideBand[];
  /** The camp-scoped Subscribe / .ics feed control, composed by CampApp (where
   *  the camp data lives). It lives in the sidebar rail (a "Subscribe" section
   *  beside View settings) on desktop and in the mobile View-settings sheet — NOT
   *  the header, whose actions cluster is now just the view switch + Add. */
  subscribeControl?: ReactNode;
  /** Resolves an activity's theme, for the per-event theme badge (events reflect
   *  their activity's theme). */
  themeOf: ThemeResolver;
  /** The effective 3-state kit stock map — drives an informational coverage dot
   *  on QuickAdd's search rows AND the day-header Gather chip. Empty ({}) = UNSET
   *  = no decoration. Never filters. */
  kitStock?: Record<string, StockState>;
  /** The materials catalog (substitution groups + names + plenty/consumable
   *  flags) for coverage + the same-day contention lens. */
  materialCatalog?: Material[];
  /** Set ONE material's stock state — the SAME fold-aware writer the run sheet
   *  and Materials tab use. Threaded so the Gather popover can cycle a row's
   *  stock (staff-gated at the source). Absent for hosts that don't wire kit. */
  setStockState?: (id: string, state: StockState) => void;
  /** Mark a material as `plenty` in the catalog (we own enough copies to share
   *  across overlapping blocks) — the Gather popover's "We have several" action.
   *  Mints a catalog entry under the frozen id when the material is derived-only.
   *  Staff-gated at the source. Absent for hosts that don't wire kit. */
  markPlenty?: (id: string, label: string) => void;
  /** Fired ONCE when the calendar has settled enough to reveal: after the
   *  client-resolved view has mounted AND the first scroll-to-today realign has
   *  run (the day-width effect's initial pass) — Month resolves on the same first
   *  paint. Lets the host hold a loading veil over the mount/layout-settle gap
   *  rather than dropping it on a blind timer. Idempotent on the caller's side. */
  onReady?: () => void;
}) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [storedView, setStoredView] = useLocalStorage<StoredViewPref>(
    "calendarView",
    "auto",
    parseStoredView
  );
  // The view-settings sheet — mobile's home for the settings that live in the
  // sidebar "View" section on desktop (the rail isn't rendered on phones).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Shade Saturday/Sunday columns with a subtle warm wash (Notion's weekend
  // shading). On by default; another local view pref, never gated on staff.
  const [shadeWeekends, setShadeWeekends] = useLocalStorage<boolean>(
    "calendarShadeWeekends",
    true,
    boolStorage
  );
  // Which weekday the MONTH grids start on (Notion's "Start week on"). Only the
  // Month view + the sidebar mini-month honour it — the rolling strip is
  // day-aligned. Default Monday matches the camp Mon–Fri rhythm.
  const [weekStart, setWeekStart] = useLocalStorage<WeekStart>(
    "calendarWeekStart",
    DEFAULT_WEEK_START,
    parseWeekStart
  );
  // How every event's --cal-tint is resolved (the "Color by" dropdown). "custom"
  // is today's per-event/activity color; the others recolor by a single axis
  // (type / rating / location / theme). Another local view pref, never staff-
  // gated — it only changes how the same events are painted, never the data.
  const [colorMode, setColorMode] = useLocalStorage<ColorMode>(
    "calendarColorMode",
    "custom",
    colorModeStorage
  );
  // The vertical hour-height zoom for the timed strip, driven by a trackpad/touch
  // pinch (and ctrl+wheel). Another local view pref, never gated on staff. The
  // LIVE value lives in slotZoomRef so a pinch can update the grid imperatively on
  // every frame (smooth, no React churn); state only carries it for persistence +
  // hydration. A short debounce flushes the settled value to storage.
  const [slotZoom, setSlotZoom] = useLocalStorage<number>(
    "calendarSlotZoom",
    1,
    slotZoomStorage
  );
  const slotZoomRef = useRef(slotZoom);
  const slotZoomPersistRef = useRef<number | null>(null);
  // Hourly weather, a quiet glance over the day for planning (see lib/weather).
  // A 3-way view pref: "off" (default) / "day" (one summary per column header) /
  // "hour" (a chip in each hour block). The location + unit are device-local view
  // prefs too (never synced) — weather is a viewing aid, not camp data.
  const [weatherMode, setWeatherMode] = useLocalStorage<WeatherMode>(
    "calendarWeatherMode",
    "off",
    parseWeatherMode
  );
  const [weatherUnit, setWeatherUnit] = useLocalStorage<TempUnit>(
    "calendarWeatherUnit",
    "f",
    parseTempUnit
  );
  const [weatherLocation, setWeatherLocation] = useLocalStorage<WeatherLocation | null>(
    "calendarWeatherLocation",
    null,
    parseWeatherLocation
  );
  // How far ahead the forecast reaches (Today / 3 / 5 / 7 / 14 / 16 days) and
  // whether to also pull measured history so past camp days show their weather.
  const [weatherRange, setWeatherRange] = useLocalStorage<WeatherRange>(
    "calendarWeatherRange",
    "7d",
    parseWeatherRange
  );
  const [weatherHistory, setWeatherHistory] = useLocalStorage<boolean>(
    "calendarWeatherHistory",
    false,
    boolStorage
  );
  // The Rain-alert threshold: at or above this daily precip probability (or on a
  // thunderstorm) a rendered day sprouts a rain-review lens on its weather chip. 0
  // = off. Device-local like the other weather prefs; validated so a garbage value
  // falls back to the default (50).
  const [rainThreshold, setRainThreshold] = useLocalStorage<RainThreshold>(
    "calendarRainThreshold",
    50,
    parseRainThreshold
  );
  // Days whose Rain Review the staffer dismissed — date-keyed, device-local, and
  // pruned of past dates on read so the list can't grow unbounded across a season.
  const [dismissedRainDays, setDismissedRainDays] = useLocalStorage<DateKey[]>(
    "calendarRainDismissed",
    [],
    parseDismissedRainDays
  );
  const weatherEnabled = weatherMode !== "off";
  const { data: weatherData, status: weatherStatus } = useWeatherForecast(
    weatherLocation,
    weatherUnit,
    weatherEnabled,
    WEATHER_RANGE_DAYS[weatherRange],
    weatherHistory ? HISTORY_PAST_DAYS : 0
  );
  // The injected hour chips + the delegated click read the latest forecast through
  // a ref so they don't re-arm the sync effect on every refresh.
  const weatherDataRef = useRef(weatherData);
  weatherDataRef.current = weatherData;
  // The forecast coverage span (earliest → latest day with data), shown in the
  // settings so it's clear how far the weather reaches.
  const weatherCoverage = useMemo(
    () => (weatherData ? forecastCoverage(weatherData) : null),
    [weatherData]
  );
  // The canonical strip width (px) last set by recomputeDayWidth, plus a 0/1 px
  // parity toggle. A vertical pinch needs FullCalendar to re-measure its slat
  // coordinates so events follow the new hour height — but FC only re-measures
  // when its clientWidth changes (a CSS row-height change is invisible to it). So
  // each pinch frame flips this one imperceptible pixel on --cal-strip-w, which is
  // exactly the (proven) path the Day/Week width zoom already uses.
  const stripWidthRef = useRef(0);
  const widthNudgeRef = useRef(0);
  // The initial view resolves client-side (coarse pointer → Day); the grid
  // mounts only after resolution so phones never flash Week first.
  const [resolvedView, setResolvedView] = useState<ViewKey | null>(null);
  // onReady fires exactly once, after the grid has mounted AND settled (Month: on
  // first paint; strip: after the first scroll-to-today realign). The ref keeps
  // the latest callback without re-arming the effect; the flag enforces once.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const firedReadyRef = useRef(false);
  // Weather joins the reveal: when it's on, hold onReady (and thus the host's
  // loading veil) until the first forecast lands — so the calendar populates its
  // weather behind the loading screen, the same way it waits on event data,
  // instead of popping chips in after the reveal. weatherGateRef = "ok to reveal",
  // readyPendingRef = "the grid settled while we were still waiting". A fallback
  // timeout (below) opens the gate so a slow/dead forecast can't trap the reveal.
  const weatherGateRef = useRef(true);
  const readyPendingRef = useRef(false);
  const fireReady = useCallback(() => {
    if (firedReadyRef.current) return;
    if (!weatherGateRef.current) {
      readyPendingRef.current = true;
      return;
    }
    firedReadyRef.current = true;
    onReadyRef.current?.();
  }, []);
  // Open/close the weather reveal gate as the forecast settles. Off → open at
  // once; enabled → wait for the first ready/error, with a 2.2s safety so a hung
  // request still reveals (the host's own veil backstop is the outer cap).
  useEffect(() => {
    const settled = !weatherEnabled || weatherStatus === "ready" || weatherStatus === "error";
    const open = () => {
      weatherGateRef.current = true;
      if (readyPendingRef.current) {
        readyPendingRef.current = false;
        fireReady();
      }
    };
    if (settled) {
      open();
      return;
    }
    weatherGateRef.current = false;
    const id = window.setTimeout(open, 2200);
    return () => window.clearTimeout(id);
  }, [weatherEnabled, weatherStatus, fireReady]);
  const [activeView, setActiveView] = useState<ViewKey>("timeGridWeek");
  // How many days the active timed view sizes to fit the viewport (the zoom).
  const targetDays = targetDaysFor(activeView);
  const targetDaysRef = useRef(targetDays);
  targetDaysRef.current = targetDays;
  // The first day of the rendered scroll strip. We render STRIP_DAYS from here and
  // re-anchor as the user scrolls near an edge; null until resolved on mount.
  const [stripStart, setStripStart] = useState<DateKey | null>(null);
  const stripStartRef = useRef<DateKey | null>(null);
  stripStartRef.current = stripStart;
  // The day-column width driving the strip's total width (so the active zoom fits
  // the viewport). A change to it re-triggers the scroll-restore effect.
  const [dayWidth, setDayWidth] = useState(0);
  // After a re-anchor (or zoom/resize) re-render, this is the day to land back at
  // the left edge so the view doesn't visibly jump. lastFirstDay dedupes the live
  // title update to once per day actually crossed (not once per scroll frame).
  const keepDayRef = useRef<DateKey | null>(null);
  const lastFirstDayRef = useRef<DateKey | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const scrollSettleRef = useRef<number | null>(null);
  // True once the first paint has scrolled the strip onto today — gates the
  // re-anchor (and the resize keep-day capture) so neither fires prematurely.
  const didInitialScrollRef = useRef(false);
  // Skip the strip-re-anchor effect's first run (the initial mount); it's only
  // for genuine re-anchors / re-entering the strip from Month.
  const stripFirstRunRef = useRef(true);
  const [title, setTitle] = useState("");
  const [todayInView, setTodayInView] = useState(true);
  const [visibleRange, setVisibleRange] = useState<{ start: DateKey; end: DateKey } | null>(null);
  // The ONE event window (QuickAdd) for every create and edit. pickTime adds
  // the when-row + commit button; without it, the slot gesture chose the when
  // and picking creates instantly.
  const [sheet, setSheet] = useState<{
    draft: EditorDraft;
    pickTime: boolean;
  } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // The stop popover (click a stop's dot/card) — lists the event(s) at that exact
  // time, each editable / deletable, plus "Add to this time". Anchored at the
  // marker like the weather card. Holds plain event rows (stops aren't FC events).
  const [stopPopover, setStopPopover] = useState<{ ids: string[]; anchor: DOMRect } | null>(null);
  // A stable opener the imperative (capture-phase) marker-click handler calls,
  // first clearing the other floating surfaces — mirrors openWxRef.
  const openStopRef = useRef((ids: string[], anchor: DOMRect) => {
    setMenu(null);
    setWxPopover(null);
    setStopPopover({ ids, anchor });
  });
  // A lone reminder's dot can be GRABBED and dragged to a new time/day (the
  // marker isn't an FC event, so this is a custom pointer-drag). beginReminderDrag
  // is kept on a ref — fed fresh closures by an effect — so the capture-phase
  // pointerdown handler can start a drag without re-binding. remDraggedRef tells
  // that handler's click branch to skip opening the editor when a drag just ended.
  const beginReminderDragRef = useRef<(marker: HTMLElement, e: PointerEvent) => void>(() => {});
  const remDraggedRef = useRef(false);
  // The instant "this"-scope commit for a series-member gesture (drag / resize /
  // rail-drag). Declared as a ref so the reminder rail-drag effect (above the
  // callback's declaration) can invoke it without a use-before-declaration cycle;
  // kept fresh in an effect once commitThisEdit exists.
  const commitThisEditRef = useRef<
    (existing: CalendarEvent, next: CalendarEvent, verb: string) => void
  >(() => {});
  // Same deal for the instant "skip this day" delete — deleteEvent sits above
  // its declaration, so it invokes through a ref kept fresh once the callback
  // exists. (The editor-save rule-changed path no longer auto-commits — it
  // opens scopePrompt instead, and the dialog's onPick calls commitScopedEdit
  // directly once it's declared, so no ref indirection is needed there.)
  const commitSkipThisRef = useRef<(event: CalendarEvent) => void>(() => {});
  // The weather detail card (click an hour chip or a day-header summary). Mutually
  // exclusive with the event menu (an effect below closes it whenever one
  // of those opens). openWxRef gives the imperative hour-chip click + the React
  // day-header button a stable opener that first clears the event surfaces.
  const [wxPopover, setWxPopover] = useState<{ target: WeatherPopoverTarget; anchor: DOMRect } | null>(null);
  const openWxRef = useRef((target: WeatherPopoverTarget, anchor: DOMRect) => {
    setMenu(null);
    setWxPopover({ target, anchor });
  });
  // The Gather popover (click a day-header kit chip) — the day's whole gather
  // list plus any hard conflicts pinned on top. Anchored at the chip like the
  // weather card; holds the DATE (rows are resolved live from dayKitByDate) so a
  // stock/plenty edit re-renders it in place. openGatherRef gives the React
  // day-header button a stable opener that first clears the other surfaces.
  const [gatherPopover, setGatherPopover] = useState<{ date: DateKey; anchor: DOMRect } | null>(null);
  const openGatherRef = useRef((date: DateKey, anchor: DOMRect) => {
    setMenu(null);
    setWxPopover(null);
    setStopPopover(null);
    setGatherPopover({ date, anchor });
  });
  // The Rain Review panel (click a day-header's rain lens) — the day's at-risk
  // outdoor blocks and their backup plans. Anchored at the chip like the weather
  // card; holds the DATE (rows resolve live from rainPlanByDate) so a promote
  // re-renders it in place. openRainRef gives the React day-header button a stable
  // opener that first clears the other floating surfaces.
  const [rainPanel, setRainPanel] = useState<{ date: DateKey; anchor: DOMRect } | null>(null);
  const openRainRef = useRef((date: DateKey, anchor: DOMRect) => {
    setMenu(null);
    setWxPopover(null);
    setStopPopover(null);
    setGatherPopover(null);
    setRainPanel({ date, anchor });
  });
  // The day-shift card ("recover time" — slide the rest of the day by N minutes,
  // or extend a running-long block). One surface behind several doors (empty-slot
  // right-click, the single-event menu's "Running long…" / "Shift day from here…",
  // and the editor's "Recover time" row), opened via a stable ref so every door
  // shares one path. Clears the other floating surfaces on open, like openWxRef.
  const [shiftBar, setShiftBar] = useState<ShiftBarTarget | null>(null);
  const openShiftRef = useRef((next: ShiftBarTarget) => {
    setMenu(null);
    setWxPopover(null);
    setStopPopover(null);
    setGatherPopover(null);
    setRainPanel(null);
    setSheet(null);
    setShiftBar(next);
  });
  // The "Skip days…" picker (a series member's context menu): a small floating
  // card listing the series' upcoming occurrence dates as toggle chips → one
  // batch skip. Holds the seriesId it acts on + the cursor point it opened at.
  const [skipPicker, setSkipPicker] = useState<{ seriesId: string; point: { x: number; y: number } } | null>(
    null
  );
  // Shift/Cmd-click (and touch long-press) multi-selection, Finder/Notion
  // semantics: the SET of selected event ids, plus a FIXED anchor that a
  // shift-click re-extends the range from. Selection is purely a view affordance
  // — it never touches stored data; only the bulk Delete / group-move / bulk-edit
  // act on it. A plain click collapses it to one and opens the popover.
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  // A cursor-anchored bulk Color / Location picker, opened from a bulk context-
  // menu item. Holds the ids it acts on so a later selection change can't
  // retarget it mid-pick.
  const [bulkPicker, setBulkPicker] = useState<BulkPickerState | null>(null);
  // The "Swap to backup ▸" picker (a single event's context menu): a small
  // floating list of the placement's resolved alternates → one promote. Holds the
  // event id + cursor point; the resolved list is re-derived live at render so a
  // concurrent edit can't act on a stale row.
  const [swapPicker, setSwapPicker] = useState<{ eventId: string; point: { x: number; y: number } } | null>(
    null
  );
  // The pending repeating-event edit/delete awaiting a scope choice.
  const [scopePrompt, setScopePrompt] = useState<ScopePrompt | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const focusDateRef = useRef<DateKey>(todayKey());
  // The LIVE event map, read by escalation closures that outlive their creating
  // render (a toast's [All]/[Following] button, or an escalate-delete). Those
  // closures capture the `escalateSeries` instance from toast-creation time, whose
  // own `events` would be stale by the time the user clicks — so the staleness
  // check and the "current live rows" snapshot must read this ref, not the closed-
  // over `events`, or a foreign write between the toast and the click goes unseen.
  const eventsRef = useRef(events);
  eventsRef.current = events;

  // Coarse pointers (phones) default to Day; everything else to Week.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let resolved: ViewKey;
    if (storedView !== "auto") {
      resolved = storedView;
    } else {
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      resolved = coarse ? "timeGridDay" : "timeGridWeek";
    }
    // Any multi-day zoom (Week or an N-day window) is unreadable under the
    // wide-phone breakpoint (--bp-wide-phone 640) — coerce it to Day there
    // regardless of the stored preference. Day and Month stay as chosen.
    if (
      (resolved === "timeGridWeek" || isNDaysView(resolved)) &&
      window.matchMedia("(max-width: 639px)").matches
    ) {
      resolved = "timeGridDay";
    }
    // Seed the scroll strip with back-runway before today so the user can scroll
    // into the past immediately; the initial scroll lands on today's week.
    setStripStart(addDays(todayKey(), -REANCHOR_SHIFT));
    setResolvedView(resolved);
    setActiveView(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const healedEvents = useMemo(() => {
    const out: CalendarEvent[] = [];
    for (const event of Object.values(events)) out.push(healEvent(event, byId));
    return out;
  }, [events, byId]);

  // "Stops": timed events grouped by exact (date, startMin) — a stop is drawn as
  // ONE overlay marker rather than FC events when it holds more than one event OR
  // any 0-minute event (a reminder). A SOLO non-zero event stays a native FC card
  // with full drag/resize/select. Grouping is pure (lib/calendar/stops) so it's
  // unit-tested in isolation. Stops never enter FC's block layout, so they don't
  // split into cramped side-by-side columns and reminders get no drag for free.
  const stops = useMemo(() => groupStops(healedEvents), [healedEvents]);
  // Every event id that belongs to a stop — pulled out of FC + the selection
  // spine and drawn by the stop-marker effect instead.
  const idsInAStop = useMemo(() => stopEventIds(stops), [stops]);

  // The marker color for one event in a stop, shared by the overlay dots/cards
  // and the stop popover so they always agree. Reminders now follow the SAME
  // coloring as any event (the active "Color by" mode via eventTint, honoring a
  // per-event override) — no special reminder tint, so a reminder reads as part
  // of the same color language as the blocks around it.
  const stopDotColor = useCallback(
    (event: CalendarEvent): string => {
      const activity = event.activityId ? byId[event.activityId] : undefined;
      const theme = activity ? themeOf(activity.id) : null;
      return eventTint(colorMode, { event, activity, themeTint: theme?.tint, locationColors });
    },
    [byId, themeOf, colorMode, locationColors]
  );

  // Keep the marker-click opener fresh. A SOLO stop (a lone reminder, the common
  // case — a bathroom break between blocks) opens the EDITOR directly, so a
  // reminder clicks open and edits exactly like any event: its day note, color,
  // time, repeat. Only a genuine multi-event stop opens the disambiguating
  // popover. (Updated in an effect so it closes over the live event map.)
  useEffect(() => {
    openStopRef.current = (ids: string[], anchor: DOMRect) => {
      setMenu(null);
      setWxPopover(null);
      // ONE entry point regardless of size: a stop click always opens the
      // popover (title · time · Edit/Delete · "Add to this time"), never the
      // full editor directly. The old split — 1 reminder → editor, 2+ →
      // popover — gave the same tap two different outcomes with no cue.
      setStopPopover({ ids, anchor });
    };
  }, []);

  // Which days carry at least one event in the active camp — the mini-month
  // dots each of these so the sidebar previews where the schedule is busy.
  const eventDays = useMemo(() => {
    const days = new Set<string>();
    for (const event of healedEvents) days.add(event.date);
    return days;
  }, [healedEvents]);

  // Same-day kit contention, computed once per day (dateKey → DayKit): the day's
  // gather list, hard conflicts (overlapping blocks fighting over one material),
  // and soft warnings (a consumable/low item two blocks share). Pure — dayKit
  // lives in lib/calendar/kitConflicts and is unit-tested in isolation. Feeds the
  // day-header Gather chip, the Gather popover, and the placement-warning probes.
  const dayKitByDate = useMemo(() => {
    const byDate = new Map<string, CalendarEvent[]>();
    for (const event of healedEvents) {
      const arr = byDate.get(event.date);
      if (arr) arr.push(event);
      else byDate.set(event.date, [event]);
    }
    const out = new Map<string, DayKit>();
    for (const [date, dayEvents] of byDate) {
      out.set(date, dayKit(dayEvents, byId, kitStock, materialCatalog));
    }
    return out;
  }, [healedEvents, byId, kitStock, materialCatalog]);
  // The Gather chip + popover read the latest map through a ref so the imperative
  // day-header click opener doesn't re-arm on every recompute.
  const dayKitByDateRef = useRef(dayKitByDate);
  dayKitByDateRef.current = dayKitByDate;

  // The Rain Review, computed once per day (dateKey → RainPlan | null): fires only
  // in "Day" weather mode with a threshold set, when the day's forecast + events
  // yield at-risk outdoor blocks. Pure (rainPlanForDay lives in lib/calendar and is
  // unit-tested). Feeds the day-header rain lens + the Rain Review panel. Empty
  // when weather is off / no threshold / no forecast (the whole feature is inert).
  const rainPlanByDate = useMemo(() => {
    const out = new Map<string, RainPlan>();
    if (weatherMode !== "day" || !rainThreshold || !weatherData) return out;
    const dismissed = new Set(dismissedRainDays);
    const byDate = new Map<string, CalendarEvent[]>();
    for (const event of healedEvents) {
      const arr = byDate.get(event.date);
      if (arr) arr.push(event);
      else byDate.set(event.date, [event]);
    }
    for (const [date, dayEvents] of byDate) {
      // A day the staffer dismissed for today shows no lens (but the plain weather
      // summary + its detail card stay).
      if (dismissed.has(date)) continue;
      const plan = rainPlanForDay(date, weatherData.daily.get(date), dayEvents, byId, rainThreshold);
      if (plan) out.set(date, plan);
    }
    return out;
  }, [healedEvents, byId, weatherMode, rainThreshold, weatherData, dismissedRainDays]);
  // The day-header rain lens + its click opener read the latest map through a ref
  // so the imperative FC header memo doesn't re-arm on every recompute.
  const rainPlanByDateRef = useRef(rainPlanByDate);
  rainPlanByDateRef.current = rainPlanByDate;

  // Every event id in chronological order — (date, then startMin, then id as a
  // stable tiebreak). This is the spine a shift-click range walks: "in between"
  // is simply the slice of this order between anchor and target, so a range
  // spans days naturally (anchor Mon 9:00 → target Wed 14:00 sweeps in Tue).
  // Ordered from the in-memory event set, independent of what's scrolled in.
  // (orderEventIds is the same pure sort, extracted to lib/calendar/selection so
  // it's unit-tested in isolation alongside the group-move math.)
  // Events inside a stop are excluded from the selection spine in the TIMED views
  // (they aren't FC events there — they're overlay markers — so they can't be a
  // range endpoint and shouldn't be swept into a shift-range). Month has no stop
  // overlay, so there they ARE real FC chips and stay in the spine.
  const orderedEventIds = useMemo(
    () =>
      orderEventIds(
        healedEvents.filter((event) => activeView === "dayGridMonth" || !idsInAStop.has(event.id))
      ),
    [healedEvents, idsInAStop, activeView]
  );
  // onEventClick reads the order + anchor through refs so it can stay a STABLE
  // callback: it's a dep of the heavy FullCalendar memo, and we don't want a
  // re-anchor (every click) or an event change to re-render the whole grid just
  // to refresh this closure. (fcEvents already triggers the grid on data change.)
  const orderedEventIdsRef = useRef(orderedEventIds);
  orderedEventIdsRef.current = orderedEventIds;
  const selectionAnchorRef = useRef(selectionAnchor);
  selectionAnchorRef.current = selectionAnchor;
  // The live selection, read by the (stable) drag callbacks to decide group vs
  // single move without re-arming the FullCalendar memo on every selection change.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  // Touch multi-select mode: a long-press on an event ARMS this (and seeds the
  // selection). While armed, a plain TAP on an event toggles it into/out of the
  // selection (instead of opening the popover), the touch twin of cmd-click —
  // the only multi-select gesture phones have (no modifier keys, no marquee).
  // Cleared when the selection empties (clearSelection / Clear). Read via a ref
  // so onEventClick stays a stable FullCalendar-memo callback.
  const touchMultiRef = useRef(false);
  // The tap that ENDS an arming long-press must be swallowed (touch only) so it
  // doesn't toggle the just-selected event straight back off. Declared up here so
  // onEventClick (above the long-press effect) can read it.
  const suppressNextTapRef = useRef(false);

  // Drop the multi-selection (set + anchor) back to empty. Called on every
  // gesture that should reset the selection: a plain background/date click, a
  // drag-create, a view change, Escape, and opening a single-event popover.
  const clearSelection = useCallback(() => {
    setSelection((prev) => (prev.size ? new Set() : prev));
    setSelectionAnchor(null);
    touchMultiRef.current = false;
  }, []);

  // Which month the mini-month surfaces: the one the visible window MOSTLY falls
  // in, not whichever month its first column happens to start in. A multi-day
  // window that straddles a boundary (e.g. Jun 29 – Jul 5) is read as the
  // majority month by anchoring on the range's midpoint, so the mini's label and
  // grid agree with the period the header states instead of lagging a month
  // behind. Day and Month views keep their month (their midpoint stays inside).
  const miniAnchor = useMemo(() => {
    if (!visibleRange) return new Date();
    const mid = Math.floor(daySpan(visibleRange.start, visibleRange.end) / 2);
    return fromDateKey(addDays(visibleRange.start, mid));
  }, [visibleRange]);

  // The live snap grid the active camp offers (5 / 10 / 15 / 30), or the app
  // default (15) with no camp. Threaded into FullCalendar's snapDuration, the
  // editor's start/end/length steps, and every re-snap call site so placement and
  // editing share ONE grid. slotDuration stays a fixed 15-min slat density — the
  // snap is about where things LAND, not how dense the grid is drawn.
  const snap = useMemo(() => campSnapMin(activeCamp), [activeCamp]);
  const snapDurationStr = useMemo(() => snapDurationString(snap), [snap]);

  // The per-day resolved windows across the rendered strip (dateKey → open window,
  // or null = CLOSED). Honors the camp's dated/weekday overrides via
  // resolveDayWindow. Feeds BOTH the shared grid union (below) and the closed-day
  // shading events — one source so the grid and the shading always agree.
  const stripDays = useMemo(() => {
    const out: DateKey[] = [];
    if (!stripStart) return out;
    for (let i = 0; i < STRIP_DAYS; i += 1) out.push(addDays(stripStart, i));
    return out;
  }, [stripStart]);
  const dayWindows = useMemo(() => {
    const map = new Map<DateKey, DayWindow | null>();
    for (const date of stripDays) map.set(date, resolveDayWindow(activeCamp, date));
    return map;
  }, [stripDays, activeCamp]);

  // The shared grid window: the UNION of every OPEN day's resolved window across
  // the rendered strip (a closed/null day contributes nothing), folded outward
  // around event extents exactly as effectiveWindow does — so the one slotMinTime/
  // slotMaxTime pair covers a strip whose days have different hours, and no event
  // ever clips. With no active camp (or no open days in the strip) this is just
  // effectiveWindow(scoped, dayWindow) — identical to the previous behavior. Kept
  // as ONE window (gridStart/gridEnd stay a single shared pair) so the three
  // %-positioned overlays that resolve against them keep working unchanged.
  const window_ = useMemo(() => {
    const stripEnd = stripStart ? addDays(stripStart, STRIP_DAYS) : null;
    const scoped =
      stripStart && stripEnd
        ? healedEvents.filter((event) => event.date >= stripStart && event.date < stripEnd)
        : healedEvents;
    // Base = the union of the strip's OPEN day windows. If a camp is active and at
    // least one strip day is open, start from that union; otherwise fall back to
    // the passed-in dayWindow (the classic band / camp base hours).
    let base: DayWindow | null = null;
    if (activeCamp) {
      for (const win of dayWindows.values()) {
        if (!win) continue; // a closed day widens nothing
        base = base
          ? { startMin: Math.min(base.startMin, win.startMin), endMin: Math.max(base.endMin, win.endMin) }
          : { startMin: win.startMin, endMin: win.endMin };
      }
    }
    return effectiveWindow(scoped, base ?? dayWindow);
  }, [healedEvents, stripStart, dayWindow, activeCamp, dayWindows]);

  // The grid is DRAWN from the enclosing whole hour so the hourly slot labels —
  // and the darker hour gridlines — land on real clock hours even when camp
  // hours open on a half-hour like 7:30. FullCalendar anchors slotLabelInterval
  // at slotMinTime, so a 7:30 start would otherwise label 7:30 / 8:30 / 9:30.
  // window_ itself (which the editor's start/length pickers read) is untouched.
  // Kept ABOVE the background-events memo (bgEvents) because the closed-day
  // shading margins resolve against this one shared grid pair.
  const gridStart = useMemo(() => Math.floor(window_.startMin / 60) * 60, [window_]);
  const gridEnd = useMemo(() => Math.ceil(window_.endMin / 60) * 60, [window_]);

  // Re-tints every event by the active "Color by" mode. A colorMode change
  // recomputes this memo, which (because each EventInput now carries a new
  // extendedProps.tint) flows through renderEventContent's paint() — the same
  // repaint path a per-event recolor already uses — so picking a mode recolors
  // the visible cards immediately, no scroll/refresh needed.
  // Stop members are pulled out of FC in the TIMED views (the overlay draws them).
  // Month has no stop overlay, so there they stay real FC chips — otherwise
  // stacked same-start events and every 0-min reminder would vanish from Month.
  // Split-day leg labels ("1/2 · 2/2") for every same-day linked pair, computed
  // once across the whole set (a tiny pure grouping in the adapter) so the card
  // renderer can chip a leg without re-scanning the store.
  const legLabels = useMemo(() => splitDayLegLabels(healedEvents), [healedEvents]);
  // Background events for the timed strip: guidance bands (soft day-structure
  // frames) + closed-day shading (the out-of-window margins each day, and a full
  // wash for a closed day). These are FullCalendar display:"background" events —
  // in FC v6 they DO run eventContent (via EventContainer's customGenerator) and
  // they let dateClick / select pass through (isValidDateDownEl explicitly excepts
  // .fc-bg-event), so a band/shaded area still creates when clicked. Non-
  // interactive otherwise (no drag/resize). Skipped entirely in Month (a soft
  // time band has no meaning on a whole-day cell). Expanded over the STABLE strip
  // horizon (anchor ± ~60 days) so it recomputes only when the guides/camp/strip
  // anchor changes — never per scroll frame.
  const bgEvents = useMemo<EventInput[]>(() => {
    if (activeView === "dayGridMonth" || !stripStart) return [];
    const out: EventInput[] = [];
    const horizonStart = addDays(stripStart, -60);
    const horizonEndExclusive = addDays(stripStart, STRIP_DAYS + 60);
    // Guidance bands — one background event per (band, date) hit.
    if (guides.length) {
      for (const { band, date } of guideBandsForRange(guides, horizonStart, horizonEndExclusive)) {
        const dayStart = fromDateKey(date);
        out.push({
          id: "guide:" + band.id + ":" + date,
          start: new Date(dayStart.getTime() + band.startMin * 60_000),
          end: new Date(dayStart.getTime() + band.endMin * 60_000),
          display: "background",
          classNames: ["cal-band"],
          title: band.label,
          extendedProps: { bgKind: "band" },
        });
      }
    }
    // Closed-day shading — the out-of-window margins each day (before open, after
    // close), and a full-column wash for a fully closed (null) day. Only when a
    // camp is active (dayWindows carries the per-day resolution). Informs, never
    // blocks — clicking shaded time still places an event.
    if (activeCamp) {
      for (const date of stripDays) {
        const win = dayWindows.get(date);
        const dayStart = fromDateKey(date);
        const shade = (fromMin: number, toMin: number) => {
          if (toMin <= fromMin) return;
          out.push({
            id: "closed:" + date + ":" + fromMin,
            start: new Date(dayStart.getTime() + fromMin * 60_000),
            end: new Date(dayStart.getTime() + toMin * 60_000),
            display: "background",
            classNames: ["cal-closed"],
            extendedProps: { bgKind: "closed" },
          });
        };
        if (win === null) {
          // A closed day: wash the whole drawn column.
          shade(gridStart, gridEnd);
        } else if (win) {
          // Shade only the margins narrower than the drawn grid.
          shade(gridStart, win.startMin);
          shade(win.endMin, gridEnd);
        }
      }
    }
    return out;
    // gridStart/gridEnd feed the closed-day margins; they change only when the
    // union window changes (a coarse, non-per-frame event).
  }, [activeView, stripStart, stripDays, dayWindows, guides, activeCamp, gridStart, gridEnd]);

  const fcEvents = useMemo(
    () => [
      ...healedEvents
        .filter((event) => activeView === "dayGridMonth" || !idsInAStop.has(event.id))
        .map((event) => {
          // The card's backup-plan badge: resolve this placement's effective list
          // (event override ?? activity default) and hand its shape to the adapter.
          const resolved = resolveAlternates(event, event.activityId ? byId[event.activityId] : undefined);
          const glyph: AlternatesGlyph | undefined = resolved.length
            ? { rain: hasRainAlternate(resolved), count: resolved.length }
            : undefined;
          // camps-2/J2: this event is "shared" (shows under every camp) when a
          // camp IS active and the event doesn't belong to it — the only way an
          // event reaches here at all with a camp active is via useCamps.filter-
          // Events, which already lets through exactly the active camp's own
          // events plus unscoped/dangling ones, so a plain id mismatch is enough.
          const shared = Boolean(activeCamp) && event.campId !== activeCamp?.id;
          return toFcEvent(event, byId, themeOf, colorMode, locationColors, legLabels[event.id], glyph, shared);
        }),
      ...bgEvents,
    ],
    [healedEvents, idsInAStop, byId, themeOf, colorMode, locationColors, activeView, legLabels, bgEvents, activeCamp]
  );

  const scrollTime = useMemo(() => {
    const anchor = Math.max(window_.startMin, Math.min(nowMinutes() - 90, window_.endMin - 120));
    return minutesToTimeString(anchor);
  }, [window_]);

  // Destructive/undoable toasts get a longer window than informational ones.
  const showToast = useCallback((next: ToastState, durationMs = 6000) => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = window.setTimeout(() => setToast(null), durationMs);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    },
    []
  );

  // Grab-and-drag a lone reminder's dot to a new time (and day). The marker is an
  // overlay, not an FC event, so this is a hand-rolled pointer drag: past a small
  // threshold it shows a snapped preview line over the column under the cursor and,
  // on release, re-times the 0-min event (kept 0-min) with an undo toast. A
  // recurring reminder routes through the same this/following/all scope prompt a
  // normal event-drop uses. Kept on a ref so the capture-phase pointerdown handler
  // starts it with the live event map + grid geometry, never re-binding.
  useEffect(() => {
    beginReminderDragRef.current = (marker, e) => {
      const ids = (marker.dataset.stopIds ?? "").split(",").filter(Boolean);
      if (ids.length !== 1) return; // only a lone reminder is draggable
      const original = events[ids[0]];
      if (!original) return;
      if (!requireStaff("move reminders")) return;
      const span = gridEnd - gridStart;
      if (span <= 0) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let ghost: HTMLElement | null = null;
      let target: { date: string; minute: number } | null = null;

      // The day column + snapped minute under a viewport point. A reminder marker
      // is pointer-events:none and the ghost is too, so elementFromPoint resolves
      // the grid cell beneath, not the markers.
      const resolve = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        const col = el instanceof Element ? el.closest<HTMLElement>(".fc-timegrid-col[data-date]") : null;
        const date = col?.getAttribute("data-date") ?? null;
        const frame = col?.querySelector<HTMLElement>(".fc-timegrid-col-frame") ?? null;
        if (!date || !frame) return null;
        const r = frame.getBoundingClientRect();
        return { date, minute: yToMinutes(y - r.top, r.height, gridStart, gridEnd), rect: r };
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        document.body.classList.remove("is-cal-dragging");
        ghost?.remove();
        marker.style.opacity = "";
      };

      function onMove(me: PointerEvent) {
        if (!dragging) {
          if (Math.abs(me.clientX - startX) < 4 && Math.abs(me.clientY - startY) < 4) return;
          dragging = true;
          remDraggedRef.current = true; // the click that follows this drag must NOT open the editor
          document.body.classList.add("is-cal-dragging");
          marker.style.opacity = "0.35"; // dim the marker being moved
          // The preview reuses the marker's own classes (hairline + plain dot), so
          // it reads identically — just lifted to the viewport and placed where the
          // reminder will land.
          ghost = document.createElement("div");
          ghost.className = "cal-stop cal-stop--line cal-rem-drag";
          ghost.style.setProperty("--rem-tint", stopDotColor(original));
          const hair = document.createElement("span");
          hair.className = "cal-stop__hair";
          const dot = document.createElement("span");
          dot.className = "cal-stop__count cal-stop__count--solo";
          ghost.append(hair, dot);
          document.body.appendChild(ghost);
        }
        const t = resolve(me.clientX, me.clientY);
        if (!ghost) return;
        if (t) {
          target = { date: t.date, minute: t.minute };
          ghost.style.left = t.rect.left + "px";
          ghost.style.width = t.rect.width + "px";
          ghost.style.top = t.rect.top + ((t.minute - gridStart) / span) * t.rect.height + "px";
          ghost.style.opacity = "1";
        } else {
          target = null;
          ghost.style.opacity = "0.3"; // off the grid — release is a no-op
        }
      }

      function onUp() {
        cleanup();
        if (!dragging || !target) return;
        if (original.date === target.date && original.startMin === target.minute) return;
        const next: CalendarEvent = {
          ...original,
          date: target.date,
          startMin: target.minute,
          endMin: target.minute, // stay a 0-min point in time
          updatedAt: Date.now(),
        };
        if (original.seriesId) {
          // A recurring reminder commits "this" instantly with an escalation toast
          // (no scope dialog), matching the drag/resize gestures.
          commitThisEditRef.current(original, next, "Moved");
          return;
        }
        upsertEvent(next);
        announce("Moved " + (original.title || "reminder") + " to " + formatClock(target.minute));
        showToast({
          message: "Moved " + (original.title || "reminder"),
          onUndo: () => upsertEvent(original),
        });
      }

      function onCancel() {
        cleanup();
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    };
  }, [events, gridStart, gridEnd, requireStaff, stopDotColor, upsertEvent, announce, showToast]);

  // The drag-create selection box is kept visible while QuickAdd is open
  // (unselectAuto is off); clear it whenever the sheet closes — saved,
  // cancelled, or dismissed — so no stray highlight is left behind.
  useEffect(() => {
    if (!sheet) calendarRef.current?.getApi().unselect();
  }, [sheet]);

  // ---- continuous day-strip navigation --------------------------------------
  // The timed views are one horizontally-scrolling strip of fixed-width days;
  // navigation is just scrolling it, and the dropdown only changes the zoom (how
  // many days are sized to fit). Month is the one view with its own grid.

  // The viewport x where the day area begins — the right edge of the sticky time
  // gutter — measured straight from the DOM (no width estimate to drift on).
  const dayAreaLeftX = useCallback((grid: HTMLElement): number | null => {
    const gutter = grid.querySelector<HTMLElement>(".fc-timegrid-slot-label, .fc-timegrid-axis");
    return gutter ? gutter.getBoundingClientRect().right : null;
  }, []);

  // The DateKey whose column currently sits at the strip's left edge.
  const firstVisibleDay = useCallback((): DateKey => {
    const grid = gridRef.current;
    const start = stripStartRef.current;
    if (!grid || !start) return start ?? todayKey();
    const edge = dayAreaLeftX(grid);
    const cells = Array.from(grid.querySelectorAll<HTMLElement>(".fc-col-header-cell[data-date]"));
    if (edge == null || !cells.length) return start;
    let best = cells[0];
    let bd = Infinity;
    for (const c of cells) {
      const d = Math.abs(c.getBoundingClientRect().left - edge);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return (best.dataset.date as DateKey) ?? start;
  }, [dayAreaLeftX]);

  // Scroll so `dayKey`'s column aligns to the day area's left edge. Works by the
  // measured DELTA between the cell and the gutter's right edge, so repeated
  // calls converge even as FullCalendar settles its layout — CSS scroll-snap only
  // fixes USER scrolls, never these programmatic ones. Returns false (→ caller
  // re-anchors) when that day isn't in the rendered strip.
  const scrollDayToLeft = useCallback(
    (dayKey: DateKey, behavior: ScrollBehavior) => {
      const grid = gridRef.current;
      if (!grid) return false;
      const cell = grid.querySelector<HTMLElement>(`.fc-col-header-cell[data-date="${dayKey}"]`);
      const edge = dayAreaLeftX(grid);
      if (!cell || edge == null) return false;
      const delta = cell.getBoundingClientRect().left - edge;
      // A small deadzone keeps the settle-snap from chasing sub-pixel jitter
      // (which would loop: scroll → scroll event → settle → scroll …).
      if (Math.abs(delta) > 2) {
        grid.scrollTo({ left: Math.max(0, Math.round(grid.scrollLeft + delta)), behavior });
      }
      return true;
    },
    [dayAreaLeftX]
  );

  // Push the visible window (header title, mini-month band, Today enablement,
  // tap-to-place day) from the live scroll position — deduped to once per day
  // (and per zoom) actually crossed so scrolling doesn't thrash React.
  const syncVisible = useCallback(() => {
    if (!stripStartRef.current) return;
    const firstKey = firstVisibleDay();
    const n = targetDaysRef.current;
    const stamp = firstKey + "|" + n;
    if (stamp === lastFirstDayRef.current) return;
    lastFirstDayRef.current = stamp;
    const endKey = addDays(firstKey, n);
    setTitle(viewTitle(fromDateKey(firstKey), n));
    setVisibleRange({ start: firstKey, end: endKey });
    const tkey = todayKey();
    const todayVisible = tkey >= firstKey && tkey < endKey;
    setTodayInView(todayVisible);
    focusDateRef.current = todayVisible ? tkey : firstKey;
  }, [firstVisibleDay]);

  // Bring `dayKey` to the left edge; re-anchor the strip first if it isn't
  // rendered (the post-render effect finishes the scroll via keepDayRef). A
  // plain scroll only works when the day can actually SIT at the left edge —
  // i.e. its index is within [0, lastStart]. A day in the strip's final window
  // (idx > lastStart) still has a cell, so scrollDayToLeft would report success,
  // yet it can never reach the edge — which left Today (and far mini-month picks
  // into the past, where today lands near the strip's right end) silently
  // stalled. Re-anchor those onto a fresh strip centred on the day instead.
  const goToDay = useCallback(
    (dayKey: DateKey, behavior: ScrollBehavior) => {
      const start = stripStartRef.current;
      const lastStart = STRIP_DAYS - targetDaysRef.current;
      const idx = start != null ? daySpan(start, dayKey) : -1;
      if (start != null && idx >= 0 && idx <= lastStart && scrollDayToLeft(dayKey, behavior)) return;
      keepDayRef.current = dayKey;
      setStripStart(addDays(dayKey, -Math.floor((STRIP_DAYS - targetDaysRef.current) / 2)));
    },
    [scrollDayToLeft]
  );

  // Prev/next (buttons, arrows, j/k): page by the visible window, smoothly.
  const nudge = useCallback(
    (dir: 1 | -1) => {
      goToDay(addDays(firstVisibleDay(), dir * targetDaysRef.current), "smooth");
    },
    [firstVisibleDay, goToDay]
  );

  // Switch view. Day/Week/N-day are zoom levels of the one strip (the day width
  // changes; the focused day is kept at the left edge by the zoom effect). Month
  // is its own grid. Either way we carry the currently-focused day across.
  const changeView = useCallback(
    (view: ViewKey) => {
      const api = calendarRef.current?.getApi();
      const anchorDay =
        api && api.view.type === "timeGridStrip" ? firstVisibleDay() : focusDateRef.current;
      // A genuine view switch (Day↔Week↔Month↔N) rebuilds the event DOM and is a
      // clean break — drop the multi-selection. (Strip scroll re-anchors fire
      // datesSet, not this, so scrolling to a selected event on another day keeps
      // the selection intact.)
      clearSelection();
      setActiveView(view);
      setStoredView(view);
      if (!api) return;
      if (view === "dayGridMonth") {
        api.changeView("dayGridMonth", fromDateKey(anchorDay));
        return;
      }
      // Keep the focused day at the left edge after the zoom/strip re-lays out.
      keepDayRef.current = anchorDay;
      if (api.view.type !== "timeGridStrip") {
        // Re-entering the strip from Month: switch the FC view AND recenter the
        // rendered strip on the focused day (the stripStart effect re-aligns).
        const newStart = addDays(anchorDay, -Math.floor((STRIP_DAYS - targetDaysFor(view)) / 2));
        api.changeView("timeGridStrip", fromDateKey(newStart));
        setStripStart(newStart);
      }
    },
    [clearSelection, firstVisibleDay, setStoredView]
  );

  // Today: bring today to the strip's left edge (or jump the Month grid to it).
  const goToday = useCallback(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (api.view.type === "dayGridMonth") {
      api.today();
      return;
    }
    goToDay(todayKey(), "smooth");
  }, [goToDay]);

  // A mini-month pick scrolls the strip so that day is at the left edge (Month
  // jumps its grid to that date).
  const gotoMiniDate = useCallback(
    (date: Date) => {
      const api = calendarRef.current?.getApi();
      if (!api) return;
      if (api.view.type === "dayGridMonth") {
        api.gotoDate(date);
        return;
      }
      goToDay(toDateKey(date), "smooth");
    },
    [goToDay]
  );

  const onDatesSet = useCallback((arg: DatesSetArg) => {
    // Navigation/view changes re-render the grid, so a cursor-anchored menu or
    // a rect-anchored popover would detach — dismiss them.
    setMenu(null);
    setStopPopover(null);
    setGatherPopover(null);
    // The strip's visible window + title are driven by scroll position
    // (syncVisible), NOT by the full rendered range — so the strip ignores this.
    // Only Month, with its own grid, reads its window straight from FullCalendar.
    if (arg.view.type !== "dayGridMonth") return;
    const start = arg.view.currentStart;
    const end = arg.view.currentEnd;
    setActiveView("dayGridMonth");
    setTitle(arg.view.title);
    const now = new Date();
    const todayVisible = now >= start && now < end;
    focusDateRef.current = todayVisible ? toDateKey(now) : toDateKey(start);
    setTodayInView(todayVisible);
    setVisibleRange({ start: toDateKey(start), end: toDateKey(end) });
  }, []);

  // The series fields an occurrence shares — pulled off the editor draft and
  // stamped onto every date by the recurrence module.
  const buildTemplate = useCallback(
    (draft: EditorDraft, campId?: string, pinned?: boolean): SeriesTemplate => {
      const activity = draft.activityId ? byId[draft.activityId] : undefined;
      const template: SeriesTemplate = {
        startMin: draft.allDay ? 0 : draft.startMin,
        endMin: endMinForDraft(draft.startMin, draft.durationMin, draft.allDay),
        allDay: draft.allDay,
        kind: activity ? "activity" : "custom",
        title: activity?.title ?? draft.title ?? "Untitled",
        campId,
      };
      if (activity) template.activityId = activity.id;
      if (draft.color) template.color = draft.color;
      if (draft.locations?.length) template.locations = draft.locations;
      if (draft.note) template.note = draft.note;
      // The editor doesn't own `pinned` (it's set from the right-click / editor
      // pin action, never a draft field), so a following/all regeneration must
      // carry it off the edited ROW or the whole series would silently un-pin.
      if (pinned) template.pinned = true;
      return template;
    },
    [byId]
  );

  // A SeriesTemplate lifted straight off a concrete row (not an editor draft) —
  // the escalation path re-runs planSeriesEdit with the row's CURRENT values as
  // the new template, so this mirrors buildTemplate but reads the fields directly.
  // Used only for "Apply to all / from here on" escalation and the toast buttons.
  const templateFromEvent = useCallback((row: CalendarEvent): SeriesTemplate => {
    const template: SeriesTemplate = {
      startMin: row.allDay ? 0 : row.startMin,
      endMin: row.allDay ? 0 : row.endMin,
      allDay: Boolean(row.allDay),
      kind: row.kind,
      title: row.title,
    };
    if (row.activityId) template.activityId = row.activityId;
    if (row.campId) template.campId = row.campId;
    if (row.color) template.color = row.color;
    if (row.locations?.length) template.locations = row.locations;
    if (row.note) template.note = row.note;
    if (row.pinned) template.pinned = true;
    return template;
  }, []);

  // The escalation staleness check (rule 2a). A toast's [All]/[Following] button
  // — or the durable context-menu escalation — may only re-plan against the
  // pre-gesture snapshot if the live store still reflects the this-commit it made:
  // every affected series row in the store must EITHER match the expected
  // post-commit state (same id → same JSON) OR be untouched (not in the expected
  // set, so a foreign add is fine as long as it didn't rewrite one of ours). We
  // detect a FOREIGN write by comparing each expected row against the live row of
  // the same id: if a row we wrote was since changed by someone else, we refuse.
  // Rows the this-commit REMOVED must still be absent. Pure — reads the live map.
  const seriesUnchangedSince = useCallback(
    (expected: CalendarEvent[], removedIds: string[], seriesId: string): boolean => {
      const live = eventsRef.current; // the LIVE map (see eventsRef rationale)
      const expectedById = new Map(expected.map((row) => [row.id, row]));
      for (const [id, row] of expectedById) {
        const liveRow = live[id];
        if (!liveRow) return false; // our row vanished (a foreign delete)
        if (rowFingerprint(liveRow) !== rowFingerprint(row)) return false;
      }
      // A row this commit removed must not have been resurrected.
      for (const id of removedIds) {
        if (live[id]) return false;
      }
      // No foreign row may have JOINED the series since (a concurrent add).
      for (const liveRow of Object.values(live)) {
        if (liveRow.seriesId === seriesId && !expectedById.has(liveRow.id)) return false;
      }
      return true;
    },
    []
  );

  // Materialize a brand-new repeating event into one occurrence per date. The
  // anchor (the event you were composing) keeps its id; the rest are fresh. The
  // whole series is one batch write, so a single Undo removes it.
  const createSeries = useCallback(
    (draft: EditorDraft, rule: RecurrenceRule, existing?: CalendarEvent) => {
      // buildTemplate carries pinned (a template field).
      const template = buildTemplate(draft, existing?.campId, draft.pinned);
      const seriesId = crypto.randomUUID();
      const anchorId = draft.id ?? crypto.randomUUID();
      const dates = recurrenceDates(draft.date, rule);
      const occurrences = buildSeriesEvents(
        template,
        dates,
        seriesId,
        rule,
        () => crypto.randomUUID(),
        draft.date,
        anchorId
      );
      upsertEvents(occurrences);
      setSheet(null);
      announce("Added repeating " + template.title);
      const ids = occurrences.map((occurrence) => occurrence.id);
      showToast(
        {
          message: "Added " + template.title + " · " + dates.length + " dates",
          onUndo: () => removeEvents(ids),
        },
        8000
      );
    },
    [announce, buildTemplate, removeEvents, showToast, upsertEvents]
  );

  // A same-day kit warning for a placement that JUST committed: recompute the
  // day's contention with `next` in place (the store may not have the new
  // geometry yet at call time), and — if `next` now sits in a hard conflict that
  // `previous` did NOT — return a toast suffix naming the material + the other
  // block. Cheap: one dayKit over the one day. Never blocks; purely a heads-up.
  const placementWarning = useCallback(
    (previous: CalendarEvent | undefined, next: CalendarEvent): string => {
      // A reminder/all-day placement gathers no kit — nothing to warn about.
      if (next.allDay || next.endMin === next.startMin || !next.activityId) return "";
      const dayEvents = healedEvents
        .filter((event) => event.date === next.date && event.id !== next.id)
        .concat(next);
      const after = dayKit(dayEvents, byId, kitStock, materialCatalog);
      const nowIn = conflictsForEvent(after, next.id);
      if (!nowIn.length) return "";
      // Was it already conflicting BEFORE the move? Compare against the day it left
      // (previous's date), so re-arranging within an existing conflict stays quiet.
      const before = previous
        ? conflictsForEvent(dayKitByDateRef.current.get(previous.date) ?? after, previous.id)
        : [];
      const beforeIds = new Set(before.map((conflict) => conflict.id));
      const fresh = nowIn.filter((conflict) => !beforeIds.has(conflict.id));
      if (!fresh.length) return "";
      // Name the first fresh clash + the first OTHER block sharing that material.
      const clash = fresh[0];
      const otherId = clash.eventIds.find((id) => id !== next.id);
      const other = otherId ? events[otherId] : undefined;
      const otherLabel = other ? other.title || "another block" : "another block";
      return " · ⚠ shares " + clash.label + " with " + otherLabel;
    },
    [byId, events, healedEvents, kitStock, materialCatalog]
  );

  const saveDraft = useCallback(
    (draft: EditorDraft) => {
      if (!requireStaff("plan the calendar")) return;
      const existing = draft.id ? events[draft.id] : undefined;
      const activity = draft.activityId ? byId[draft.activityId] : undefined;
      const startMin = draft.allDay ? 0 : draft.startMin;
      const endMin = endMinForDraft(draft.startMin, draft.durationMin, draft.allDay);
      const isReminder = !draft.allDay && endMin === startMin; // 0-min marker
      // The editor save is a PATCH over the stored row, not a rebuild: spread the
      // existing event first so fields the editor doesn't own (campId, pinned,
      // future payload fields) survive the save — mirroring applyBulkEdit, which
      // patches rows in place. Rebuilding from the draft silently un-scoped
      // camp events on every edit.
      const event: CalendarEvent = {
        ...existing,
        id: draft.id ?? crypto.randomUUID(),
        date: draft.date,
        startMin,
        endMin,
        // Trust the draft's activityId: a just-created library activity links
        // here before byId catches up on the next render. A dangling ref still
        // self-heals to "custom" at render time (healEvent + normalizers).
        kind: draft.activityId ? "activity" : "custom",
        title: activity?.title ?? draft.title ?? "Untitled",
        updatedAt: Date.now(),
      };
      // Editor-owned optionals: the draft's value wins, INCLUDING a clear —
      // deleting here (after the spread) is what makes clearing stick on edits.
      if (draft.activityId) event.activityId = draft.activityId;
      else delete event.activityId;
      if (draft.allDay) event.allDay = true;
      else delete event.allDay;
      if (draft.color) event.color = draft.color;
      else delete event.color;
      if (draft.locations?.length) event.locations = draft.locations;
      else delete event.locations;
      if (draft.note) event.note = draft.note;
      else delete event.note;
      // Pin rides the draft (carried off the edited row): the draft's value wins,
      // including a clear. A plain edit carries it through unchanged (draftFromEvent
      // seeds it off the event).
      if (draft.pinned) event.pinned = true;
      else delete event.pinned;

      // Editing an event that ALREADY belongs to a series. Rule UNTOUCHED → an
      // instant "this" commit (a per-occurrence exception via commitThisEdit,
      // with an escalation toast) — "this" already has its own well-understood
      // instant path, so no dialog for a plain field edit. Rule CHANGED or
      // CLEARED → ASK the scope via SeriesScopeDialog (quickadd-1/2: this used
      // to silently auto-pick "following" with zero visibility into what
      // "following" vs "all" actually means before committing; now the user
      // picks, same as the "Delete entire series…" safety hatch already does).
      if (existing?.seriesId) {
        if (rulesEqual(existing.recurrence, draft.recurrence)) {
          // Keep the series fields on the this-edit row (planOccurrenceEdit reads
          // the target's own rule; the patched `event` carries them via the spread).
          commitThisEditRef.current(existing, event, draft.id ? "Updated" : "Moved");
        } else {
          // Close the editor sheet first — the scope dialog is a decision on
          // TOP of the edit, never stacked alongside it (pattern 2's "never two
          // stacked modals" contract).
          setSheet(null);
          setScopePrompt({ mode: "edit", event: existing, draft });
        }
        return;
      }
      // A new (or previously one-off) event gaining a repeat → build the series.
      if (draft.recurrence) {
        createSeries(draft, draft.recurrence, existing);
        return;
      }
      upsertEvent(event);
      setSheet(null);
      announce((draft.id ? "Updated " : "Added ") + (isReminder ? "reminder " : "") + event.title);
      // Same-day kit heads-up: naming a fresh hard conflict this save created
      // (empty for a clean placement, a reminder, or one already conflicting).
      const warn = placementWarning(existing, event);
      if (!draft.id) {
        const toastState: ToastState = {
          message:
            "Added " +
            (isReminder ? "reminder " : "") +
            event.title +
            (event.allDay ? " · all day" : " · " + formatClock(event.startMin)) +
            warn,
          onUndo: () => removeEvent(event.id),
        };
        // A brand-new one-off gets a one-tap path into the library ("Save to
        // library" defaults off): the action creates the Routine activity and
        // links this placement to it — reversible, never modal.
        if (!event.activityId && event.title) {
          toastState.action = {
            label: "Save to library",
            onClick: () => {
              const created = onCreateActivity(event.title, isReminder ? 0 : endMin - startMin);
              if (!created) return; // staff gate blocked it
              upsertEvent({
                ...event,
                activityId: created.id,
                kind: "activity",
                title: created.title,
                updatedAt: Date.now(),
              });
              announce("Saved " + created.title + " to library");
            },
          };
        }
        showToast(toastState);
      } else if (warn && existing) {
        // Editing an existing event into a fresh conflict — surface the same
        // undoable heads-up (a new add already carries it on its create toast).
        showToast({
          message: "Updated " + event.title + warn,
          onUndo: () => upsertEvent(existing),
        });
      }
    },
    [announce, byId, createSeries, events, onCreateActivity, placementWarning, removeEvent, requireStaff, showToast, upsertEvent]
  );

  const deleteEvent = useCallback(
    (event: CalendarEvent) => {
      if (!requireStaff("change the calendar")) return;
      // A repeating event skips THIS day instantly (a durable exdate), with a toast
      // offering to escalate to "Delete following" / "Delete all" — no scope dialog.
      if (event.seriesId) {
        commitSkipThisRef.current(event);
        return;
      }
      removeEvent(event.id);
      setSheet(null);
      // A split-day leg carries a linkId shared with its sibling on the same day.
      // Deleting one leg leaves the other; the toast offers "Delete both" to remove
      // the sibling too (rule 8).
      const sibling = event.linkId
        ? healedEvents.find(
            (e) => e.id !== event.id && e.linkId === event.linkId && e.date === event.date
          )
        : undefined;
      const toastState: ToastState = {
        message: "Deleted " + (event.title || "event"),
        onUndo: () => upsertEvent({ ...event, updatedAt: Date.now() }),
      };
      if (sibling) {
        toastState.actions = [
          {
            label: "Delete both",
            onClick: () => {
              if (!requireStaff("change the calendar")) return;
              removeEvent(sibling.id);
              announce("Deleted both runs");
              showToast(
                {
                  message: "Deleted both runs",
                  onUndo: () =>
                    upsertEvents([
                      { ...event, updatedAt: Date.now() },
                      { ...sibling, updatedAt: Date.now() },
                    ]),
                },
                8000
              );
            },
          },
        ];
      }
      showToast(toastState, 8000);
      announce("Deleted " + event.title);
    },
    [announce, healedEvents, removeEvent, requireStaff, showToast, upsertEvent, upsertEvents]
  );

  // Pin / unpin an event in place — SCOPE-FREE and SERIES-WIDE (an adversarial
  // review mandated this: a partially-pinned series is unrepresentable from every
  // surface). For a plain event it's one flag-only upsert; for a series member it
  // flag-flips EVERY row sharing the seriesId (no regeneration — pinned is a plain
  // payload field, so a targeted flag write is enough), all as ONE commit + undo.
  // A pinned event holds its position when a day-shift moves the rest of the day.
  const togglePin = useCallback(
    (event: CalendarEvent) => {
      if (!requireStaff("plan the calendar")) return;
      const nextPinned = !event.pinned;
      // The rows this toggle rewrites: the whole series, or just this event.
      const rows = event.seriesId ? eventsInSeries(events, event.seriesId) : [event];
      const before: CalendarEvent[] = [];
      const after: CalendarEvent[] = [];
      for (const row of rows) {
        before.push(row);
        const next = { ...row, updatedAt: Date.now() };
        if (nextPinned) next.pinned = true;
        else delete next.pinned;
        after.push(next);
      }
      if (!after.length) return;
      commitEvents(after, []);
      const scopeNote = event.seriesId ? " — whole series" : "";
      const label =
        (nextPinned ? "Pinned " : "Unpinned ") + (event.title || "event") + scopeNote;
      announce(label);
      showToast({
        message: label,
        onUndo: () => commitEvents(before.map((r) => ({ ...r, updatedAt: Date.now() })), []),
      });
    },
    [announce, commitEvents, events, requireStaff, showToast]
  );

  // Turn a one-off placement into a reusable library activity — the same one-tap
  // path the create-toast's "Save to library" offers, but reachable later from
  // the event's own menu. Creates the Routine activity and links THIS event to
  // it; undo unlinks. Only offered for an ISOLATED event (no library link) that
  // carries a title — an attached event already lives in the library.
  const saveToLibrary = useCallback(
    (event: CalendarEvent) => {
      if (!requireStaff("change the library")) return;
      const isReminder = !event.allDay && event.endMin === event.startMin;
      const duration = event.allDay || isReminder ? 0 : event.endMin - event.startMin;
      const created = onCreateActivity(event.title, duration);
      if (!created) return; // staff gate / empty title blocked it
      upsertEvent({
        ...event,
        activityId: created.id,
        kind: "activity",
        title: created.title,
        updatedAt: Date.now(),
      });
      const label = "Saved " + created.title + " to library";
      announce(label);
      showToast({ message: label, onUndo: () => upsertEvent(event) });
    },
    [announce, onCreateActivity, requireStaff, showToast, upsertEvent]
  );

  // Commit a day-shift plan (the ShiftBar's Commit button). The bar computed the
  // plan.upserts; here we run the staff gate, commit ONE batch (removes always []
  // — day-shift never deletes), snapshot the before-rows for a single Undo, and
  // announce. The bar closes on commit.
  const commitDayShift = useCallback(
    (upserts: CalendarEvent[], summary: string) => {
      if (!requireStaff("plan the calendar")) return;
      if (!upserts.length) return;
      const before: CalendarEvent[] = [];
      for (const next of upserts) {
        const live = events[next.id];
        if (live) before.push(live);
      }
      commitEvents(upserts, []);
      setShiftBar(null);
      const count = upserts.length;
      const label = "Shifted " + count + (count === 1 ? " event" : " events");
      announce(label + (summary ? " · " + summary : ""));
      showToast(
        {
          message: label,
          onUndo: () => commitEvents(before.map((r) => ({ ...r, updatedAt: Date.now() })), []),
        },
        8000
      );
    },
    [announce, commitEvents, events, requireStaff, showToast]
  );

  // Bulk-delete the whole multi-selection as ONE undoable step. We deliberately do
  // NOT pop the recurring this/following/all dialog (a bulk delete is predictable:
  // what you selected is exactly what goes). But it must be DURABLE: a selected
  // series member becomes a real skip (its slot exdated on every survivor) via
  // planBulkSeriesRemovals, so a later "all"/"following" edit can't resurrect it;
  // plain rows are just removed. All in ONE commit; the single Undo restores the
  // exact pre-delete rows (removed occurrences AND the survivors whose exdates
  // changed).
  const deleteSelection = useCallback(() => {
    if (!requireStaff("change the calendar")) return;
    const ids = [...selection].filter((id) => events[id]);
    if (!ids.length) return;
    const allRows = Object.values(events).map((event) => healEvent(event, byId));
    const plan = planBulkSeriesRemovals(allRows, ids);
    // Snapshot the exact live rows the plan touches so Undo restores them verbatim
    // (survivors' pre-edit exdates + the removed occurrences).
    const touched = new Set([...plan.upserts.map((e) => e.id), ...plan.removes]);
    const before: CalendarEvent[] = [];
    for (const id of touched) {
      const live = events[id];
      if (live) before.push(healEvent(live, byId));
    }
    commitEvents(plan.upserts, plan.removes);
    clearSelection();
    setSheet(null);
    const count = ids.length;
    const label = "Deleted " + count + (count === 1 ? " event" : " events");
    announce(label);
    showToast(
      {
        message: label,
        // Restore every touched row in one step (stamp updatedAt so the
        // last-write-wins store re-accepts them after the delete).
        onUndo: () => commitEvents(before.map((event) => ({ ...event, updatedAt: Date.now() })), []),
      },
      8000
    );
  }, [announce, byId, clearSelection, commitEvents, events, requireStaff, selection, showToast]);

  // Apply a bulk edit across the whole selection in ONE undoable commit. Only the
  // fields the panel actually TOUCHED are applied (the "leave unchanged unless
  // touched" model); date/time shifts ride the same per-day clamp the group move
  // uses. Recurring occurrences are edited as predictable single rows here too
  // (no scope dialog), matching bulk-delete / group-move.
  const applyBulkEdit = useCallback(
    (ids: string[], changes: BulkEditChanges) => {
      if (!requireStaff("change the calendar")) return;
      const before: CalendarEvent[] = [];
      const after: CalendarEvent[] = [];
      const shift =
        changes.dayShift || changes.minShift
          ? { dayDelta: changes.dayShift ?? 0, minDelta: changes.minShift ?? 0 }
          : null;
      for (const id of ids) {
        const live = events[id];
        if (!live) continue;
        const original = healEvent(live, byId);
        // The customizable-field names this edit touches on THIS row — stamped
        // into a series member's `custom` (via applyCustomStamp) so a later
        // "all"/"following" regeneration preserves the bulk change instead of
        // rebuilding it away. Built alongside the value writes below.
        const touchedFields: string[] = [];
        let next: CalendarEvent = { ...original };
        if ("color" in changes) {
          if (changes.color) next.color = changes.color;
          else delete next.color;
          touchedFields.push("color");
        }
        // Multi-location set (the merged model): a non-empty array replaces the
        // event's places; an empty array (or absent value) clears them.
        if ("locations" in changes) {
          if (changes.locations && changes.locations.length) next.locations = changes.locations;
          else delete next.locations;
          touchedFields.push("locations");
        }
        if ("allDay" in changes && changes.allDay !== undefined) {
          if (changes.allDay) {
            next.allDay = true;
            next.startMin = 0;
            next.endMin = 0;
          } else if (next.allDay) {
            // Turning all-day OFF needs a real timed span — seed a default block.
            delete next.allDay;
            next.startMin = DEFAULT_PLANNING_START_MIN;
            next.endMin = Math.min(MINUTES_PER_DAY, DEFAULT_PLANNING_START_MIN + DEFAULT_DURATION_MIN);
          }
          touchedFields.push("allDay", "startMin", "endMin");
        }
        // A date/time shift rides last so it composes with an all-day change.
        if (shift) {
          next = applyMoveDelta(next, shift, snap);
          touchedFields.push("date", "startMin", "endMin");
        }
        // Durability: on a SERIES member, stamp the touched fields into `custom`
        // (and origDate when the date moved) BEFORE writing updatedAt, off the
        // PRE-edit row so origDate captures the slot it used to occupy.
        if (next.seriesId && touchedFields.length) {
          const stamped = applyCustomStamp(original, touchedFields);
          if (stamped.custom) next.custom = stamped.custom;
          if (stamped.origDate !== undefined) next.origDate = stamped.origDate;
        }
        next.updatedAt = Date.now();
        before.push(original);
        after.push(next);
      }
      if (!after.length) return;
      commitEvents(after, []);
      // Keep the touched set selected so a follow-up bulk action stays in scope.
      setSelection(new Set(after.map((ev) => ev.id)));
      const count = after.length;
      const label = "Updated " + count + (count === 1 ? " event" : " events");
      announce(label);
      showToast({
        message: label,
        onUndo: () => commitEvents(before, []),
      });
    },
    [announce, byId, commitEvents, events, requireStaff, showToast, snap]
  );

  // camps-2/J2: "Claim into <active camp>" — stamps campId onto every SHARED
  // (unscoped/dangling) event in the selection, one undoable commit. Only ever
  // offered when a camp is active (the context-menu items below gate on it);
  // events already belonging to a DIFFERENT camp are left untouched (claiming is
  // additive, never a forced re-assignment away from another camp).
  const claimIntoActiveCamp = useCallback(
    (ids: string[]) => {
      if (!activeCamp) return;
      if (!requireStaff("change the calendar")) return;
      const before: CalendarEvent[] = [];
      const after: CalendarEvent[] = [];
      for (const id of ids) {
        const live = events[id];
        if (!live) continue;
        const original = healEvent(live, byId);
        if (original.campId) continue; // already scoped to a camp — leave it.
        before.push(original);
        after.push({ ...original, campId: activeCamp.id, updatedAt: Date.now() });
      }
      if (!after.length) return;
      commitEvents(after, []);
      const count = after.length;
      const label = "Claimed " + count + (count === 1 ? " event" : " events") + " into " + activeCamp.name;
      announce(label);
      showToast({
        message: label,
        onUndo: () => commitEvents(before, []),
      });
    },
    [activeCamp, announce, byId, commitEvents, events, requireStaff, showToast]
  );

  // Swap a placement to one of its backup plans — the single self-inverse promote,
  // shared by QuickAdd's Backup rows, the "Swap to backup ▸" context menu, and the
  // Rain Review panel. planPromote does the pure swap (copy-on-write onto
  // event.alternates); on a SERIES member the changed fields are stamped into
  // `custom` (applyCustomStamp) so the swap survives regeneration, exactly like
  // applyBulkEdit. One undoable commit + a spoken result.
  const promoteBackup = useCallback(
    (event: CalendarEvent, index: number) => {
      if (!requireStaff("change the calendar")) return;
      const live = events[event.id];
      if (!live) return;
      const original = healEvent(live, byId);
      const resolved = resolveAlternates(original, original.activityId ? byId[original.activityId] : undefined);
      const target = resolved[index];
      if (!target) return;
      let next = planPromote(original, index, resolved);
      // Durability on a series member: title/activityId/kind/locations/alternates
      // can all move, so stamp every promote-touched field into `custom`.
      if (next.seriesId) {
        const stamped = applyCustomStamp(original, ["title", "activityId", "kind", "locations", "alternates"]);
        if (stamped.custom) next.custom = stamped.custom;
        if (stamped.origDate !== undefined) next.origDate = stamped.origDate;
      }
      next = { ...next, updatedAt: Date.now() };
      commitEvents([next], []);
      const label = "Swapped to " + (target.title || "backup");
      announce(label);
      showToast({
        message: label,
        onUndo: () => commitEvents([{ ...original, updatedAt: Date.now() }], []),
      });
    },
    [announce, byId, commitEvents, events, requireStaff, showToast]
  );

  // Switch every at-risk block on a rainy day to its first backup — the Rain
  // Review's "Switch all N" as ONE undoable commit. Only rows that actually resolve
  // to a backup are swapped; a row with no backup on file is left alone. Series
  // members are stamped so each swap survives regeneration.
  const promoteAllForDay = useCallback(
    (date: DateKey) => {
      if (!requireStaff("change the calendar")) return;
      const plan = rainPlanByDateRef.current.get(date);
      if (!plan) return;
      const before: CalendarEvent[] = [];
      const after: CalendarEvent[] = [];
      for (const row of plan.rows) {
        if (!row.alternates.length) continue;
        const live = events[row.event.id];
        if (!live) continue;
        const original = healEvent(live, byId);
        const resolved = resolveAlternates(
          original,
          original.activityId ? byId[original.activityId] : undefined
        );
        if (!resolved.length) continue;
        let next = planPromote(original, 0, resolved);
        if (next.seriesId) {
          const stamped = applyCustomStamp(original, [
            "title",
            "activityId",
            "kind",
            "locations",
            "alternates",
          ]);
          if (stamped.custom) next.custom = stamped.custom;
          if (stamped.origDate !== undefined) next.origDate = stamped.origDate;
        }
        next = { ...next, updatedAt: Date.now() };
        before.push(original);
        after.push(next);
      }
      if (!after.length) return;
      commitEvents(after, []);
      const count = after.length;
      const label = "Switched " + count + " outdoor block" + (count === 1 ? "" : "s") + " to backups";
      announce(label);
      showToast({
        message: label,
        onUndo: () => commitEvents(before.map((r) => ({ ...r, updatedAt: Date.now() })), []),
      });
    },
    [announce, byId, commitEvents, events, requireStaff, showToast]
  );

  // Write (or clear) a placement's own backup list — the "Edit backups…" / "No
  // backups for this day" copy-on-write from QuickAdd, and the Rain Review's "Pick
  // backup…". `list` REPLACES event.alternates (an empty array is authoritative
  // "none here"). Series members stamp `alternates` into `custom` so the override
  // survives regeneration.
  const setEventAlternates = useCallback(
    (event: CalendarEvent, list: AlternateRef[]) => {
      if (!requireStaff("change the calendar")) return;
      const live = events[event.id];
      if (!live) return;
      const original = healEvent(live, byId);
      let next: CalendarEvent = { ...original, alternates: list };
      if (next.seriesId) {
        const stamped = applyCustomStamp(original, ["alternates"]);
        if (stamped.custom) next.custom = stamped.custom;
        if (stamped.origDate !== undefined) next.origDate = stamped.origDate;
      }
      next = { ...next, updatedAt: Date.now() };
      commitEvents([next], []);
      announce("Updated backup plans");
      showToast({
        message: "Updated backup plans",
        onUndo: () => commitEvents([{ ...original, updatedAt: Date.now() }], []),
      });
    },
    [announce, byId, commitEvents, events, requireStaff, showToast]
  );

  // Dismiss a day's Rain Review for today (device-local, date-keyed). Closes the
  // panel and drops the day-header lens; the plain weather summary stays.
  const dismissRainDay = useCallback(
    (date: DateKey) => {
      setDismissedRainDays((prev) => (prev.includes(date) ? prev : [...prev, date]));
      setRainPanel(null);
      announce("Dismissed the rain review for today");
    },
    [announce, setDismissedRainDays]
  );

  // Delete a wider slice of a repeating series — the "Delete entire series…"
  // safety hatch (following / all). "This"-scope deletes have their own instant
  // skip path (commitSkipThis / deleteEvent), so this only handles the wider two.
  const commitSeriesDelete = useCallback(
    (event: CalendarEvent, scope: SeriesScope) => {
      const seriesId = event.seriesId;
      if (!seriesId) return;
      const series = eventsInSeries(events, seriesId);
      const ids = planSeriesDelete(series, event, scope);
      const before = series.filter((occurrence) => ids.includes(occurrence.id));
      removeEvents(ids);
      setScopePrompt(null);
      setSheet(null);
      announce("Deleted " + (event.title || "event"));
      showToast(
        {
          message: "Deleted " + ids.length + (ids.length === 1 ? " event" : " events"),
          onUndo: () => upsertEvents(before),
        },
        8000
      );
    },
    [announce, events, removeEvents, showToast, upsertEvents]
  );

  // ---- instant-scope recurrence gestures (the P3 wave) ----------------------
  // Routine gestures on a series member commit IMMEDIATELY at a default scope (no
  // this/following/all dialog): a toast then offers to ESCALATE the same edit to a
  // wider scope. The escalation re-plans planSeriesEdit against the PRE-GESTURE
  // snapshot (so this-then-all ≡ all directly — the escalate-equivalence contract)
  // and commits as a SECOND undoable step, guarded by a staleness check so a
  // foreign write in between can't silently clobber the series.

  // Run one escalation to `scope` from a captured pre-gesture snapshot. Verifies
  // the this-commit still stands (seriesUnchangedSince), then re-plans + commits.
  // `escalatedRow` is the row whose current values become the new template (the
  // committed this-edit's row); `draftDate`/`rule` describe the pattern to apply.
  const escalateSeries = useCallback(
    (opts: {
      seriesId: string;
      snapshot: CalendarEvent[];
      expected: CalendarEvent[];
      removed: string[];
      escalatedRow: CalendarEvent;
      draftDate: DateKey;
      rule: RecurrenceRule | undefined;
      scope: SeriesScope;
      title: string;
    }) => {
      if (!requireStaff("change the calendar")) return;
      if (!seriesUnchangedSince(opts.expected, opts.removed, opts.seriesId)) {
        showToast({ message: "Series changed — edit it directly" });
        return;
      }
      // Find the target in the SNAPSHOT (planSeriesEdit reasons over the snapshot).
      const target =
        opts.snapshot.find((row) => row.id === opts.escalatedRow.id) ?? opts.snapshot[0];
      if (!target) return;
      const template = templateFromEvent(opts.escalatedRow);
      // "All" from an anchor edit collapses in planSeriesEdit already; here scope is
      // passed straight through.
      const plan = planSeriesEdit(
        opts.snapshot,
        target,
        template,
        opts.draftDate,
        opts.rule,
        opts.scope,
        () => crypto.randomUUID()
      );
      // Snapshot the CURRENT live rows the escalation touches (read the LIVE map,
      // not the closed-over `events` — this closure outlives its creating render),
      // so Undo restores the exact state that existed just before this second
      // commit (the this-edit result), not the pre-gesture one.
      const live = eventsRef.current;
      const touchedIds = new Set([...plan.upserts.map((e) => e.id), ...plan.removes]);
      const beforeLive: CalendarEvent[] = [];
      for (const id of touchedIds) {
        const row = live[id];
        if (row) beforeLive.push(row);
      }
      const addedIds = plan.upserts.map((e) => e.id).filter((id) => !live[id]);
      commitEvents(plan.upserts, plan.removes);
      const scopeNote = opts.scope === "all" ? " · all events" : " · this & following";
      announce("Updated " + opts.title + scopeNote);
      showToast(
        {
          message: "Updated " + opts.title + scopeNote,
          onUndo: () => commitEvents(beforeLive, addedIds),
        },
        8000
      );
    },
    [announce, commitEvents, requireStaff, seriesUnchangedSince, showToast, templateFromEvent]
  );

  // Commit a "this" occurrence edit instantly (drag / resize / rail-drag / editor
  // save with the rule untouched). Builds `next` off the gesture, runs
  // planOccurrenceEdit, commits ONE row, and raises a toast whose [All]/[Following]
  // buttons escalate the SAME edit from the pre-gesture snapshot. `dayLabel` names
  // the occurrence's weekday for the toast ("Moved this Tue only").
  const commitThisEdit = useCallback(
    (existing: CalendarEvent, next: CalendarEvent, verb: string) => {
      const seriesId = existing.seriesId;
      if (!seriesId) return;
      const snapshot = eventsInSeries(events, seriesId);
      const plan = planOccurrenceEdit(snapshot, existing, next);
      commitEvents(plan.upserts, plan.removes);
      setScopePrompt(null);
      setSheet(null);
      const committed = plan.upserts[0] ?? next;
      const title = existing.title || "event";
      const weekday = fromDateKey(committed.date).toLocaleDateString(undefined, { weekday: "short" });
      announce(verb + " " + title + " — this " + weekday + " only");
      // The rule for an escalation is the target's own denormalized rule.
      const rule = existing.recurrence;
      const draftDate = committed.date;
      const escalate = (scope: SeriesScope) => () =>
        escalateSeries({
          seriesId,
          snapshot,
          expected: plan.upserts,
          removed: plan.removes,
          escalatedRow: committed,
          draftDate,
          rule,
          scope,
          title,
        });
      showToast(
        {
          message: verb + " this " + weekday + " only",
          actions: [
            { label: "All", onClick: escalate("all") },
            { label: "Following", onClick: escalate("following") },
          ],
          onUndo: () => commitEvents([existing], plan.upserts.map((e) => e.id).filter((id) => id !== existing.id)),
        },
        8000
      );
    },
    [announce, commitEvents, escalateSeries, events, showToast]
  );
  // Keep the rail-drag's ref fresh (see commitThisEditRef declaration).
  useEffect(() => {
    commitThisEditRef.current = commitThisEdit;
  }, [commitThisEdit]);

  // Commit an editor save whose RULE CHANGED, at an EXPLICIT scope the user
  // picked from SeriesScopeDialog (quickadd-1/2: this used to auto-pick
  // "following" with no dialog — see saveDraft below, which now opens the
  // dialog instead of calling this directly). Still collapses "following" to
  // "all" when the edited row is the series anchor (its "following" span
  // already covers the whole series, and "all" reads cleaner) — the dialog
  // only offers "following"/"all" ("this" has its own instant unchanged-rule
  // path in saveDraft), so this collapse just picks the cleaner of the two
  // when they're equivalent. Toast: "Updated from here on" + [Whole series].
  // The rule-CLEARED case keeps the same planner branch (planSeriesEdit with
  // rule undefined) at whichever scope was picked/collapsed to.
  const commitScopedEdit = useCallback(
    (prompt: Extract<ScopePrompt, { mode: "edit" }>, pickedScope: SeriesScope) => {
      const seriesId = prompt.event.seriesId;
      if (!seriesId) return;
      const snapshot = eventsInSeries(events, seriesId);
      const isAnchor = snapshot.length > 0 && snapshot[0].id === prompt.event.id;
      const scope: SeriesScope = isAnchor ? "all" : pickedScope;
      const template = buildTemplate(prompt.draft, prompt.event.campId, prompt.event.pinned);
      const plan = planSeriesEdit(
        snapshot,
        prompt.event,
        template,
        prompt.draft.date,
        prompt.draft.recurrence,
        scope,
        () => crypto.randomUUID()
      );
      commitEvents(plan.upserts, plan.removes);
      setScopePrompt(null);
      setSheet(null);
      const beforeIds = new Set(snapshot.map((e) => e.id));
      const newIds = plan.upserts.map((e) => e.id).filter((id) => !beforeIds.has(id));
      const cleared = !prompt.draft.recurrence;
      const message = cleared
        ? scope === "all"
          ? "Stopped repeating"
          : "Stopped repeating from here on"
        : scope === "all"
          ? "Updated all events"
          : "Updated from here on";
      announce(message);
      const toastState: ToastState = {
        message,
        onUndo: () => commitEvents(snapshot, newIds),
      };
      // Offer the wider "Whole series" escalation only when we didn't already run
      // "all" (an anchor edit, or a "following" that started at the first row).
      if (scope !== "all") {
        toastState.actions = [
          {
            label: "Whole series",
            onClick: () =>
              escalateSeries({
                seriesId,
                snapshot,
                expected: plan.upserts,
                removed: plan.removes,
                escalatedRow: plan.upserts.find((e) => e.id === prompt.event.id) ?? prompt.event,
                draftDate: prompt.draft.date,
                rule: prompt.draft.recurrence,
                scope: "all",
                title: template.title,
              }),
          },
        ];
      }
      showToast(toastState, 8000);
    },
    [announce, buildTemplate, commitEvents, escalateSeries, events, showToast]
  );

  // Commit an instant "skip this day" delete of a series member (planSeriesSkip,
  // a durable exdate). Toast: "Skipped this day" + [Delete following] [Delete all].
  const commitSkipThis = useCallback(
    (event: CalendarEvent) => {
      const seriesId = event.seriesId;
      if (!seriesId) return;
      const snapshot = eventsInSeries(events, seriesId);
      const plan = planSeriesSkip(snapshot, event);
      commitEvents(plan.upserts, plan.removes);
      setScopePrompt(null);
      setSheet(null);
      announce("Skipped " + (event.title || "event"));
      // Escalation here is a wider DELETE, not an edit — re-plan planSeriesDelete
      // against the snapshot, guarded by the same staleness check. Restore-on-undo
      // snapshots the LIVE rows being removed (the this-skip already ran, so the
      // survivors carry fresh exdates and the skipped target is already gone) — so
      // Undo restores exactly what THIS commit removed, cleanly layered on the skip.
      const escalateDelete = (scope: "following" | "all") => () => {
        if (!requireStaff("change the calendar")) return;
        if (!seriesUnchangedSince(plan.upserts, plan.removes, seriesId)) {
          showToast({ message: "Series changed — edit it directly" });
          return;
        }
        const live = eventsRef.current;
        const ids = planSeriesDelete(snapshot, event, scope).filter((id) => live[id]);
        if (!ids.length) return;
        const before = ids.map((id) => live[id]);
        removeEvents(ids);
        announce("Deleted " + ids.length + (ids.length === 1 ? " event" : " events"));
        showToast(
          {
            message: "Deleted " + ids.length + (ids.length === 1 ? " event" : " events"),
            onUndo: () => upsertEvents(before),
          },
          8000
        );
      };
      showToast(
        {
          message: "Skipped this day",
          actions: [
            { label: "Delete following", onClick: escalateDelete("following") },
            { label: "Delete all", onClick: escalateDelete("all") },
          ],
          onUndo: () => commitEvents(snapshot, []),
        },
        8000
      );
    },
    [
      announce,
      commitEvents,
      events,
      removeEvents,
      requireStaff,
      seriesUnchangedSince,
      showToast,
      upsertEvents,
    ]
  );
  useEffect(() => {
    commitSkipThisRef.current = commitSkipThis;
  }, [commitSkipThis]);

  // ---- durable escalation, reset, skip-days, split-day (rules 3/5/6/8) -------

  // Escalate a CUSTOMIZED row's current state to a wider scope durably (the
  // right-click / editor "Apply to all occurrences" / "Apply from here on"). Unlike
  // the toast escalation this reads the LIVE series (the customization is already
  // stored), so no staleness guard is needed — planSeriesEdit regenerates that
  // scope from the row's own values as the new template. One undoable commit.
  const applyRowScope = useCallback(
    (row: CalendarEvent, scope: "all" | "following") => {
      if (!requireStaff("change the calendar")) return;
      const seriesId = row.seriesId;
      if (!seriesId) return;
      const before = eventsInSeries(events, seriesId);
      const target = before.find((e) => e.id === row.id) ?? row;
      const template = templateFromEvent(target);
      const plan = planSeriesEdit(
        before,
        target,
        template,
        target.date,
        target.recurrence,
        scope,
        () => crypto.randomUUID()
      );
      commitEvents(plan.upserts, plan.removes);
      setMenu(null);
      setSheet(null);
      const beforeIds = new Set(before.map((e) => e.id));
      const newIds = plan.upserts.map((e) => e.id).filter((id) => !beforeIds.has(id));
      const scopeNote = scope === "all" ? " · all events" : " · this & following";
      const title = target.title || "event";
      announce("Updated " + title + scopeNote);
      showToast(
        {
          message: "Applied to " + (scope === "all" ? "all events" : "this & following"),
          onUndo: () => commitEvents(before, newIds),
        },
        8000
      );
    },
    [announce, commitEvents, events, requireStaff, showToast, templateFromEvent]
  );

  // Reset a customized occurrence back to a plain series member (rule 5) — drop
  // its per-field overrides, rebuilding from the freshest clean sibling. One
  // upsert; undoable to the pre-reset row.
  const resetOccurrence = useCallback(
    (row: CalendarEvent) => {
      if (!requireStaff("change the calendar")) return;
      const seriesId = row.seriesId;
      if (!seriesId) return;
      const series = eventsInSeries(events, seriesId);
      const before = series.find((e) => e.id === row.id) ?? row;
      const plan = planResetOccurrence(series, before);
      commitEvents(plan.upserts, plan.removes);
      setMenu(null);
      setSheet(null);
      announce("Reset " + (row.title || "event") + " to the series");
      showToast(
        {
          message: "Reset to series",
          onUndo: () => commitEvents([before], []),
        },
        8000
      );
    },
    [announce, commitEvents, events, requireStaff, showToast]
  );

  // Restore a skipped day (rule 6): mint a fresh occurrence back onto `date` and
  // strip it from every survivor's exdates. Threaded to the RepeatField's "Skipped
  // dates" restore rows AND the skip-days picker. One undoable commit.
  const restoreOccurrence = useCallback(
    (seriesId: string, date: DateKey) => {
      if (!requireStaff("change the calendar")) return;
      const series = eventsInSeries(events, seriesId);
      if (!series.length) return;
      const plan = planRestoreOccurrence(series, date, () => crypto.randomUUID());
      const touched = new Set([...plan.upserts.map((e) => e.id), ...plan.removes]);
      const before: CalendarEvent[] = [];
      for (const id of touched) {
        const live = events[id];
        if (live) before.push(live);
      }
      const addedIds = plan.upserts.map((e) => e.id).filter((id) => !events[id]);
      commitEvents(plan.upserts, plan.removes);
      announce("Restored " + date);
      showToast(
        {
          message: "Restored this day",
          onUndo: () => commitEvents(before, addedIds),
        },
        8000
      );
    },
    [announce, commitEvents, events, requireStaff, showToast]
  );

  // Batch "skip these days" from the skip-days picker (rule 6): union every chosen
  // date into every survivor's exdates + remove the concrete rows on those days.
  // One commit, one undo.
  const skipManyDays = useCallback(
    (seriesId: string, dates: DateKey[]) => {
      if (!requireStaff("change the calendar")) return;
      if (!dates.length) return;
      const series = eventsInSeries(events, seriesId);
      const plan = planSeriesSkipMany(series, dates);
      const touched = new Set([...plan.upserts.map((e) => e.id), ...plan.removes]);
      const before: CalendarEvent[] = [];
      for (const id of touched) {
        const live = events[id];
        if (live) before.push(live);
      }
      commitEvents(plan.upserts, plan.removes);
      setSkipPicker(null);
      const count = plan.removes.length;
      announce("Skipped " + count + (count === 1 ? " day" : " days"));
      showToast(
        {
          message: "Skipped " + count + (count === 1 ? " day" : " days"),
          onUndo: () => commitEvents(before, []),
        },
        8000
      );
    },
    [announce, commitEvents, events, requireStaff, showToast]
  );

  // "Add second run today" (split days, rule 8): clone this event's IDENTITY at
  // the next free slot on its own day, sharing a fresh linkId (the target gains it
  // too). On a SERIES member the target's linkId is stamped via planOccurrenceEdit
  // (custom:["linkId"]) so the leg marker survives regeneration; a plain event just
  // takes the linkId inline. One commit, one undo. No auto-fan of identity edits.
  const addSecondRun = useCallback(
    (event: CalendarEvent) => {
      if (!requireStaff("plan the calendar")) return;
      if (event.allDay) return; // a timed event only
      const linkId = crypto.randomUUID();
      const span = event.endMin - event.startMin;
      const duration = span <= 0 ? 0 : snapDurationMin(span);
      const dayEvents = healedEvents.filter((e) => e.date === event.date);
      const free = nextFreeStartForDay(dayEvents, Math.max(duration, 1), event.endMin, window_);
      const startMin = free ?? event.startMin;
      // The clone shares identity (title/activityId/kind/color/locations/pinned)
      // but NOT seriesId/recurrence/custom/origDate/note — a fresh one-off leg. It
      // carries the shared linkId.
      const clone: CalendarEvent = {
        id: crypto.randomUUID(),
        date: event.date,
        startMin,
        endMin: duration <= 0 ? startMin : Math.min(MINUTES_PER_DAY, startMin + duration),
        kind: event.kind,
        title: event.title,
        linkId,
        updatedAt: Date.now(),
      };
      if (event.activityId) clone.activityId = event.activityId;
      if (event.campId) clone.campId = event.campId;
      if (event.color) clone.color = event.color;
      if (event.locations?.length) clone.locations = [...event.locations];
      if (event.pinned) clone.pinned = true;
      if (event.allDay) clone.allDay = true;

      const upserts: CalendarEvent[] = [clone];
      const removes: string[] = [];
      const before: CalendarEvent[] = [];
      // Stamp the TARGET with the same linkId. On a series member this is a durable
      // this-edit (custom:["linkId"]); on a plain event, a plain inline write.
      if (event.seriesId) {
        const series = eventsInSeries(events, event.seriesId);
        const next: CalendarEvent = { ...event, linkId, updatedAt: Date.now() };
        const plan = planOccurrenceEdit(series, event, next);
        upserts.push(...plan.upserts);
        removes.push(...plan.removes);
        before.push(event);
      } else {
        upserts.push({ ...event, linkId, updatedAt: Date.now() });
        before.push(event);
      }
      commitEvents(upserts, removes);
      setMenu(null);
      setSheet(null);
      announce("Added a second run of " + (event.title || "event"));
      showToast(
        {
          message: "Added second run",
          // Undo: drop the clone, restore the target's pre-link row.
          onUndo: () => commitEvents(before, [clone.id]),
        },
        8000
      );
    },
    [announce, commitEvents, events, healedEvents, requireStaff, showToast, window_]
  );

  // Duplicate an event: clone it onto the next free slot of the same day so the
  // copy doesn't sit exactly on top of the original; fall back to the same start
  // if the day is full. Undoable like every other calendar mutation.
  const duplicateEvent = useCallback(
    (event: CalendarEvent) => {
      if (!requireStaff("plan the calendar")) return;
      // Preserve a 0-min reminder as 0-min (snapDurationMin would floor it to 15).
      const span = event.endMin - event.startMin;
      const duration = span <= 0 ? 0 : snapDurationMin(span);
      let startMin = event.startMin;
      if (!event.allDay) {
        const dayEvents = healedEvents.filter((e) => e.date === event.date);
        const free = nextFreeStartForDay(dayEvents, duration, event.startMin, window_);
        if (free != null) startMin = free;
      }
      const copy: CalendarEvent = {
        ...event,
        id: crypto.randomUUID(),
        startMin: event.allDay ? 0 : startMin,
        endMin: event.allDay ? 0 : Math.min(MINUTES_PER_DAY, startMin + duration),
        updatedAt: Date.now(),
      };
      // A duplicate is a standalone one-off, never a phantom member of the
      // original's series — drop the recurrence + its exception bookkeeping
      // (custom/origDate) so it isn't tied to it, and drop the split-day linkId so
      // the copy isn't spuriously a leg of the original's linked pair.
      delete copy.seriesId;
      delete copy.recurrence;
      delete copy.custom;
      delete copy.origDate;
      delete copy.linkId;
      upsertEvent(copy);
      announce("Duplicated " + (event.title || "event"));
      showToast({
        message: "Duplicated " + (event.title || "event"),
        onUndo: () => removeEvent(copy.id),
      });
    },
    [announce, healedEvents, removeEvent, requireStaff, showToast, upsertEvent, window_]
  );

  // Duplicate the whole multi-selection as ONE undoable step: each member is
  // cloned onto the next free slot of its own day (reusing the single-event
  // placement rule), and the running per-day event list is grown with each clone
  // so two copies on the same day don't stack on top of each other. Like the bulk
  // delete/move, recurring members clone as plain standalone one-offs. The new
  // copies become the live selection so a follow-up bulk action stays in scope.
  const duplicateSelection = useCallback(
    (ids: string[]) => {
      if (!requireStaff("plan the calendar")) return;
      // Seed a per-day working list from the live events so free-slot search sees
      // the real day, then append each clone so later clones avoid earlier ones.
      const dayLists = new Map<DateKey, CalendarEvent[]>();
      const dayEventsFor = (date: DateKey) => {
        let list = dayLists.get(date);
        if (!list) {
          list = healedEvents.filter((e) => e.date === date);
          dayLists.set(date, list);
        }
        return list;
      };
      const copies: CalendarEvent[] = [];
      for (const id of ids) {
        const live = events[id];
        if (!live) continue;
        const event = healEvent(live, byId);
        const span = event.endMin - event.startMin;
        const duration = span <= 0 ? 0 : snapDurationMin(span); // keep 0-min reminders 0-min
        let startMin = event.startMin;
        if (!event.allDay) {
          const free = nextFreeStartForDay(dayEventsFor(event.date), duration, event.startMin, window_);
          if (free != null) startMin = free;
        }
        const copy: CalendarEvent = {
          ...event,
          id: crypto.randomUUID(),
          startMin: event.allDay ? 0 : startMin,
          endMin: event.allDay ? 0 : Math.min(MINUTES_PER_DAY, startMin + duration),
          updatedAt: Date.now(),
        };
        delete copy.seriesId;
        delete copy.recurrence;
        delete copy.custom;
        delete copy.origDate;
        delete copy.linkId;
        copies.push(copy);
        dayEventsFor(copy.date).push(copy);
      }
      if (!copies.length) return;
      commitEvents(copies, []);
      const copyIds = copies.map((c) => c.id);
      setSelection(new Set(copyIds));
      const count = copies.length;
      const label = "Duplicated " + count + (count === 1 ? " event" : " events");
      announce(label);
      showToast({
        message: label,
        onUndo: () => removeEvents(copyIds),
      });
    },
    [announce, byId, commitEvents, events, healedEvents, removeEvents, requireStaff, showToast, window_]
  );

  // Toggle all-day on/off across the whole selection in one undoable commit (the
  // bulk menu's "All day" / "Timed"). Delegates to applyBulkEdit so it shares the
  // all-day clamp (seed a default timed span when turning OFF) + the toast/undo.
  const setSelectionAllDay = useCallback(
    (ids: string[], allDay: boolean) => applyBulkEdit(ids, { allDay }),
    [applyBulkEdit]
  );

  // The Add button (header on desktop, FAB on mobile): nothing prechosen and no
  // slot to borrow a time from — so this is the ONE create surface that also
  // shows the when-controls (date · all-day · start · length) + a commit button.
  // pickTime=true. (A slot tap/drag already carries its time, so it stays the
  // lean instant surface.) The richer details — color, location, repeat, day
  // note — live on the edit surface you reach by clicking the placed event.
  const openAddSheet = useCallback(() => {
    if (!requireStaff("plan the calendar")) return;
    setSheet({
      draft: {
        date: focusDateRef.current,
        startMin: DEFAULT_PLANNING_START_MIN,
        durationMin: DEFAULT_DURATION_MIN,
        allDay: false,
        title: "",
      },
      pickTime: true,
    });
  }, [requireStaff]);

  // --- FullCalendar callbacks -------------------------------------------

  const onSelect = useCallback(
    (info: DateSelectArg) => {
      const api = calendarRef.current?.getApi();
      if (info.view.type === "dayGridMonth") {
        // Month cells are whole days — picking a time needs a time grid.
        api?.unselect();
        showToast({ message: "To pick a time, switch to Day or Week — or tap a day to open it" });
        return;
      }
      if (!requireStaff("plan the calendar")) {
        api?.unselect();
        return;
      }
      // A create gesture (drag-select on empty grid) drops any multi-selection.
      clearSelection();
      // Keep the selection: unselectAuto is off, so the dashed landing box stays
      // on screen (a click inside QuickAdd won't drop it) until the sheet closes
      // — see the sheet-close effect. That's what makes a drag-create span
      // persist instead of vanishing the instant the drag ends.
      const startMin = minutesOfDay(info.start);
      const endMin = info.allDay
        ? startMin + DEFAULT_DURATION_MIN
        : Math.max(startMin + SNAP_MIN, Math.round((info.end.getTime() - fromDateKey(toDateKey(info.start)).getTime()) / 60_000));
      // A drag-select is always a deliberate span — its length must win over any
      // activity's recommended duration once an activity is chosen.
      setSheet({
        draft: {
          date: toDateKey(info.start),
          startMin,
          durationMin: Math.min(MINUTES_PER_DAY - startMin, endMin - startMin),
          allDay: info.allDay,
          title: "",
          explicitDuration: !info.allDay,
        },
        pickTime: false,
      });
    },
    [clearSelection, requireStaff, showToast]
  );

  const onDateClick = useCallback(
    (info: DateClickArg) => {
      // A plain background/day click is a "deselect everything" gesture (Finder/
      // Notion) — drop the multi-selection before any view jump or create.
      clearSelection();
      if (info.view.type === "dayGridMonth") {
        // Google behavior: a month cell opens that day.
        calendarRef.current?.getApi().changeView("timeGridDay", info.date);
        setActiveView("timeGridDay");
        setStoredView("timeGridDay");
        return;
      }
      if (!requireStaff("plan the calendar")) return;
      const startMin = snapMinutes(minutesOfDay(info.date), snap);
      // Smart default: a tap that lands in a TIGHT gap squeezed between two timed
      // events reads as "there's no room for a block here" → seed a 0-min reminder
      // length. A tap in open space keeps the normal default block length. Only a
      // default — the Length picker still switches freely. The gap threshold rides
      // the snap so a coarse camp grid still recognizes a "no room" gap.
      const dateKey = toDateKey(info.date);
      const tightGap =
        !info.allDay && isTightGapBetweenEvents(healedEvents, dateKey, startMin, Math.max(30, snap));
      // A single tap gives no span — the chosen activity's recommended length applies
      // (or 0 = reminder, in a tight gap).
      setSheet({
        draft: {
          date: dateKey,
          startMin,
          durationMin: tightGap ? 0 : DEFAULT_DURATION_MIN,
          allDay: info.allDay,
          title: "",
          // A typed name in the gap creates a 0-min reminder; picking a library
          // activity still uses the activity's own length (a real block).
          explicitDuration: false,
        },
        pickTime: false,
      });
    },
    [clearSelection, healedEvents, requireStaff, setStoredView, snap]
  );

  // Slot posture: a picked activity (or a custom title) creates immediately,
  // with Undo. The dragged span wins; otherwise the recommended length.
  const quickAddActivity = useCallback(
    (activity: Activity) => {
      const draft = sheet?.draft;
      if (!draft || !requireStaff("plan the calendar")) return;
      const duration = draft.explicitDuration
        ? snapDurationMin(draft.durationMin)
        : snapDurationMin(activity.durationMin || draft.durationMin);
      const startMin = draft.allDay ? 0 : draft.startMin;
      const event: CalendarEvent = {
        id: crypto.randomUUID(),
        date: draft.date,
        startMin,
        endMin: draft.allDay ? 0 : Math.min(MINUTES_PER_DAY, startMin + duration),
        kind: "activity",
        title: activity.title,
        activityId: activity.id,
        updatedAt: Date.now(),
      };
      if (draft.allDay) event.allDay = true;
      upsertEvent(event);
      setSheet(null);
      announce("Added " + event.title);
      showToast({
        message: "Added " + activity.title + (event.allDay ? " · all day" : " · " + formatClock(startMin)),
        onUndo: () => removeEvent(event.id),
      });
    },
    [announce, sheet, removeEvent, requireStaff, showToast, upsertEvent]
  );

  // Open the editor on one event of a stop (from the stop popover).
  const openStopEdit = useCallback(
    (event: CalendarEvent) => {
      if (!requireStaff("plan the calendar")) return;
      setStopPopover(null);
      setSheet({ draft: draftFromEvent(event), pickTime: true });
    },
    [requireStaff]
  );

  // "Add to this time" from the stop popover — the lean create surface seeded at
  // the stop's exact date + start, so the picked (or named) event joins the same
  // stop the moment it's placed.
  const openAddAtStop = useCallback(
    (date: DateKey, startMin: number) => {
      if (!requireStaff("plan the calendar")) return;
      setStopPopover(null);
      setSheet({
        draft: {
          date,
          startMin,
          durationMin: DEFAULT_DURATION_MIN,
          allDay: false,
          title: "",
        },
        pickTime: false,
      });
    },
    [requireStaff]
  );

  const onEventClick = useCallback(
    (info: EventClickArg) => {
      info.jsEvent.preventDefault();
      // The tap that ENDS an arming long-press is swallowed here so it doesn't
      // immediately toggle the just-selected event back off (touch only).
      if (suppressNextTapRef.current) {
        suppressNextTapRef.current = false;
        return;
      }
      const event = events[info.event.id];
      if (!event) return;
      const id = info.event.id;
      const shift = info.jsEvent.shiftKey;
      const toggle = info.jsEvent.metaKey || info.jsEvent.ctrlKey;

      // SHIFT — range-select from the FIXED anchor to this event, inclusive, in
      // chronological order (so it spans days). The anchor stays put, so a second
      // shift-click re-extends the range from the same origin (Finder/Notion).
      // With no anchor yet, this just selects + anchors here. Never opens the
      // popover. Reads order/anchor via refs to keep this callback memo-stable.
      if (shift) {
        const order = orderedEventIdsRef.current;
        const anchor = selectionAnchorRef.current;
        if (!anchor || anchor === id) {
          setSelection(new Set([id]));
          setSelectionAnchor(id);
          return;
        }
        setSelection(rangeSelection(order, anchor, id));
        return; // anchor unchanged
      }

      // CMD/CTRL — toggle just this event in/out of the selection and make it the
      // new anchor (so a following shift-click extends from here). No popover.
      if (toggle) {
        setSelection((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setSelectionAnchor(id);
        return;
      }

      // TOUCH MULTI-SELECT — once a long-press has armed multi mode, a plain tap
      // TOGGLES this event (the touch twin of cmd-click) instead of opening the
      // popover, so phones can build a selection with no modifier keys.
      if (touchMultiRef.current) {
        setSelection((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          // Tapping the last one back off exits touch-multi mode.
          if (next.size === 0) touchMultiRef.current = false;
          return next;
        });
        setSelectionAnchor(id);
        return;
      }

      // PLAIN click — collapse any multi-selection to just this event (it becomes
      // the new anchor), then open the editor directly. The click popover was
      // retired: clicking an event now routes straight into the edit sheet, and
      // the quick actions (Open Run List, Duplicate, Delete, Repeat) live on the
      // right-click menu (desktop) and inside the editor itself (touch parity).
      // Viewers (no canEdit) just select — we don't wall a plain view-click with
      // a sign-in prompt, so the editor only opens for staff.
      setSelection(new Set([id]));
      setSelectionAnchor(id);
      if (canEdit) setSheet({ draft: draftFromEvent(healEvent(event, byId)), pickTime: true });
    },
    [byId, canEdit, events]
  );

  // Right-click an event → themed context menu at the cursor. Delegated on the
  // grid (FullCalendar's event DOM isn't React-owned), resolving the event from
  // the id stamped in onEventDidMount. Pointer-fine only; touch users get the
  // same actions via the tap-opened popover (and the coarse-pointer selection
  // bar for bulk).
  //
  // When the right-clicked event is part of a multi-selection (>1), open the BULK
  // menu over the whole selection instead of the single-event menu. Right-
  // clicking an event OUTSIDE the selection opens the plain single-event menu (it
  // doesn't silently retarget the selection) — same as the popover's plain-click.
  const onGridContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (typeof window !== "undefined" && !window.matchMedia("(pointer: fine)").matches) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-event-id]");
      const id = el?.dataset.eventId;
      if (!id) {
        // Empty-slot right-click → a "Shift day from <time>…" door. ONLY inside a
        // timed day column frame (never a Month cell, never the all-day lane), so
        // the reminder-drag hit-test recipe resolves the day + snapped minute of
        // the click (yToMinutes off the column frame's height across the drawn
        // gridStart..gridEnd window).
        const col = (e.target as HTMLElement).closest<HTMLElement>(".fc-timegrid-col[data-date]");
        const date = col?.getAttribute("data-date");
        const frame = col?.querySelector<HTMLElement>(".fc-timegrid-col-frame");
        if (!date || !frame) return;
        const r = frame.getBoundingClientRect();
        const cutoffMin = yToMinutes(e.clientY - r.top, r.height, gridStart, gridEnd);
        e.preventDefault();
        const point = { x: e.clientX, y: e.clientY };
        setMenu({ kind: "shift", date, cutoffMin, point });
        return;
      }
      const event = events[id];
      if (!event) return;
      e.preventDefault();
      const point = { x: e.clientX, y: e.clientY };
      const sel = selectionRef.current;
      if (sel.has(id) && sel.size > 1) {
        setMenu({ kind: "bulk", ids: [...sel], point });
        return;
      }
      setMenu({ kind: "single", event: healEvent(event, byId), point });
    },
    [byId, events, gridStart, gridEnd]
  );

  // ---- Touch long-press → multi-select arm --------------------------------
  // Phones have no modifier keys and no marquee, so the entry into multi-select
  // is a long-press on an event: it seeds the selection and arms touch-multi mode
  // (after which a tap toggles — see onEventClick). We detect the press ourselves
  // (a 500ms still-finger timer over an event harness) rather than via FC's drag
  // long-press, so a long-press SELECTS instead of starting a move; once a group
  // is selected, FC's own long-press drag group-moves it (startMoveAffordance
  // reads the selection, modifier-free). suppressNextTapRef swallows the
  // touchend's eventClick so the arming press doesn't immediately toggle back off.
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const LONG_PRESS_MS = 500;
    const MOVE_TOLERANCE = 10; // px — beyond this the press is a scroll, not a hold

    const cancel = () => {
      if (longPressTimerRef.current != null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressOriginRef.current = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return cancel(); // two-finger = pinch-zoom; leave it
      const target = e.target as HTMLElement | null;
      const el = target?.closest<HTMLElement>("[data-event-id]");
      const id = el?.dataset.eventId;
      if (!id || !events[id]) return;
      const touch = e.touches[0];
      longPressOriginRef.current = { x: touch.clientX, y: touch.clientY };
      cancel();
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        // Arm touch-multi + seed the selection with this event. Swallow the
        // touchend's tap so it doesn't toggle the just-selected event back off.
        touchMultiRef.current = true;
        suppressNextTapRef.current = true;
        setMenu(null);
        // The arm must be FELT the moment it fires — the React-driven ring
        // paints a deferred frame later, so a finger still on the card gets no
        // cue that the hold "took". Paint the ring synchronously on the live
        // card (the selection effect re-asserts it) and give a short haptic
        // where the platform offers one.
        grid
          .querySelector(`[data-event-id="${typeof CSS !== "undefined" ? CSS.escape(id) : id}"]`)
          ?.classList.add("cal-event--selected");
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(10);
        setSelection((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        setSelectionAnchor(id);
        announce("Selected — tap more events, then use the bar");
      }, LONG_PRESS_MS);
    };
    const onTouchMove = (e: TouchEvent) => {
      const origin = longPressOriginRef.current;
      if (!origin) return;
      const touch = e.touches[0];
      if (!touch) return cancel();
      if (
        Math.abs(touch.clientX - origin.x) > MOVE_TOLERANCE ||
        Math.abs(touch.clientY - origin.y) > MOVE_TOLERANCE
      ) {
        cancel(); // the finger moved — a scroll/drag, not a hold
      }
    };

    grid.addEventListener("touchstart", onTouchStart, { passive: true });
    grid.addEventListener("touchmove", onTouchMove, { passive: true });
    grid.addEventListener("touchend", cancel);
    grid.addEventListener("touchcancel", cancel);
    return () => {
      cancel();
      grid.removeEventListener("touchstart", onTouchStart);
      grid.removeEventListener("touchmove", onTouchMove);
      grid.removeEventListener("touchend", cancel);
      grid.removeEventListener("touchcancel", cancel);
    };
  }, [announce, events]);

  // ---- Drag affordance (three-part move preview) --------------------------
  // The move gesture shows three things at once, like Notion/Apple Calendar:
  //   1. ORIGINAL — stays in its slot, dimmed + darkened (where it was). FC
  //      hides the dragged source via inline visibility:hidden on its harness;
  //      calendar.css forces it back visible and dims it.
  //   2. SUPERPOSITION — a full-opacity copy of the card that follows the cursor
  //      FREELY (un-snapped), keeping the grab offset, showing the live time. FC
  //      only gives us a *snapped* mirror, so we render this follower ourselves
  //      and feed it the mirror's live innerHTML each frame.
  //   3. SNAP BOX — FullCalendar's own .fc-event-mirror, which snaps to the grid
  //      slot the drop will land in; calendar.css styles it as a dotted no-fill
  //      outline at full opacity.
  // (The earlier position:fixed column-offset is gone — .calshell no longer
  // retains a transform after its entrance animation.)
  const followRef = useRef<HTMLDivElement | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const grabOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 12, dy: 12 });
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragCleanupRef = useRef<(() => void) | null>(null);
  // The harness of the event currently being moved — tagged so ONLY it dims,
  // not the whole calendar.
  const sourceHarnessRef = useRef<HTMLElement | null>(null);
  // Whether Option/Alt is held during the current move — a copy-drag (drop a
  // duplicate, leave the original in place) rather than a move. Tracked live so
  // pressing/releasing Option mid-drag flips the affordance; the drop reads the
  // final state.
  const altDragRef = useRef(false);
  // The ids being GROUP-moved together (the live selection at drag start, when
  // the grabbed event was part of a multi-selection). Empty for a single-event
  // move. Read at drop time so the whole group shifts by the grabbed event's
  // delta in one undoable commit. The harnesses of every member are also dimmed
  // for the duration of the drag (tracked so they can be un-dimmed on stop).
  const groupMoveRef = useRef<string[]>([]);
  const groupHarnessesRef = useRef<HTMLElement[]>([]);

  // Reflect copy-drag mode: the body class drives the visual cue (the carried
  // card gets a "+" copy badge, the original shows un-dimmed because it stays,
  // and the cursor becomes the copy cursor), and onEventDrop reads altDragRef.
  const setCopyMode = useCallback((on: boolean) => {
    if (altDragRef.current === on) return;
    altDragRef.current = on;
    document.body.classList.toggle("is-cal-copy", on);
  }, []);

  const traceFollower = useCallback(() => {
    dragRafRef.current = window.requestAnimationFrame(traceFollower);
    const follow = followRef.current;
    if (!follow) return;
    const mirror = document.querySelector<HTMLElement>(".fc-event-mirror");
    if (!mirror) return; // hold last frame through FC's mirror rebuilds
    const r = mirror.getBoundingClientRect();
    if (r.width < 1) return;
    // Mirror the live card (title + the time text FC updates as it snaps) and
    // the event's tint, so the follower reads as the same card with the new time.
    if (follow.innerHTML !== mirror.innerHTML) follow.innerHTML = mirror.innerHTML;
    const tint = mirror.style.getPropertyValue("--cal-tint");
    if (tint) follow.style.setProperty("--cal-tint", tint);
    // Carry the activity/custom spine over too: a custom event's hatched spine
    // must ride along on the carried card, not flatten to the solid spine the
    // bare .cal-dragfollow ships. The mirror carries the same .cal-event--custom
    // class the event cards do; sync it each frame so a mirror rebuild can't drop
    // it. (CSS gives the matching follower the hatch — calendar.css.)
    follow.classList.toggle("cal-event--custom", mirror.classList.contains("cal-event--custom"));
    follow.style.width = r.width + "px";
    follow.style.height = r.height + "px";
    // Free follow: top-left tracks the cursor minus where it was grabbed —
    // but clamp the card HORIZONTALLY to the calendar grid so it can never spill
    // onto the sidebar. Without this, grabbing the right half of a card in the
    // leftmost day column pushes the card's left edge out under the cursor and
    // over the rail, leaving the preview "stuck" on the sidebar's edge. Vertical
    // stays free so the card still reads as lifting/lowering with the cursor.
    let followLeft = pointerRef.current.x - grabOffsetRef.current.dx;
    const grid = gridRef.current;
    if (grid) {
      const g = grid.getBoundingClientRect();
      followLeft = Math.max(g.left, Math.min(followLeft, g.right - r.width));
    }
    follow.style.left = followLeft + "px";
    follow.style.top = pointerRef.current.y - grabOffsetRef.current.dy + "px";
    follow.style.opacity = "1";
    // A group move dresses the follower with two restrained cues (calendar.css):
    // a "stacked cards" hint behind it and a count PILL pinned to the top-right
    // corner (a CSS ::after off data-group-count), clear of the title/time. The
    // count rides the attribute so it survives the per-frame innerHTML swap above
    // (a child node wouldn't). Cleared for a single-event move. The count is the
    // size of the selection captured at drag start (groupMoveRef) — the same set
    // the drop moves; we keep the visuals on the ref so they don't churn React.
    const groupCount = groupMoveRef.current.length;
    if (groupCount > 1) {
      follow.setAttribute("data-group-count", String(groupCount));
      follow.classList.add("is-group");
    } else {
      follow.removeAttribute("data-group-count");
      follow.classList.remove("is-group");
    }
  }, []);

  const addPointerSafetyNet = useCallback(
    (onEnd: () => void, trackCopy = false) => {
      const onMove = (e: PointerEvent) => {
        pointerRef.current = { x: e.clientX, y: e.clientY };
        if (trackCopy) setCopyMode(e.altKey);
      };
      // Option can be pressed/released without moving the pointer, so watch the
      // key directly too (the event's altKey reflects the post-change state).
      const onAltKey = (e: KeyboardEvent) => setCopyMode(e.altKey);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      window.addEventListener("blur", onEnd);
      if (trackCopy) {
        window.addEventListener("keydown", onAltKey);
        window.addEventListener("keyup", onAltKey);
      }
      dragCleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        window.removeEventListener("blur", onEnd);
        window.removeEventListener("keydown", onAltKey);
        window.removeEventListener("keyup", onAltKey);
      };
    },
    [setCopyMode]
  );

  const stopDragAffordance = useCallback(() => {
    document.body.classList.remove("is-cal-dragging");
    document.body.classList.remove("is-cal-resizing");
    document.body.classList.remove("is-cal-copy");
    altDragRef.current = false;
    if (dragRafRef.current != null) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    if (followRef.current) {
      followRef.current.style.opacity = "0";
      followRef.current.innerHTML = "";
      // Reset the spine style so the next drag (which may grab an activity) never
      // briefly inherits the previous custom card's hatch.
      followRef.current.classList.remove("cal-event--custom");
      followRef.current.classList.remove("is-group");
      followRef.current.removeAttribute("data-group-count");
    }
    sourceHarnessRef.current?.classList.remove("is-drag-source");
    sourceHarnessRef.current = null;
    // Un-dim every group-move origin and forget the group (so the next single
    // drag isn't mistaken for a group move).
    for (const el of groupHarnessesRef.current) el.classList.remove("is-drag-source");
    groupHarnessesRef.current = [];
    groupMoveRef.current = [];
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  // MOVE: the three-part preview (dim the dragged event, free-follow card, snap
  // box). Only fires on eventDragStart, never on resize.
  const startMoveAffordance = useCallback(
    (arg: { el: HTMLElement; jsEvent: MouseEvent }) => {
      document.body.classList.add("is-cal-dragging");
      const cx = arg.jsEvent.clientX;
      const cy = arg.jsEvent.clientY;
      pointerRef.current = { x: cx, y: cy };
      const srcRect = arg.el.getBoundingClientRect();
      grabOffsetRef.current = { dx: cx - srcRect.left, dy: cy - srcRect.top };
      // Tag ONLY this event's harness so the dim is scoped to it.
      const harness = arg.el.closest<HTMLElement>(
        ".fc-timegrid-event-harness, .fc-daygrid-event-harness"
      );
      if (harness) {
        harness.classList.add("is-drag-source");
        sourceHarnessRef.current = harness;
      }
      // GROUP MOVE: if the grabbed event is part of a multi-selection (size > 1),
      // the whole selection moves together. Dim every selected origin's harness
      // (not just the grabbed one) so it reads as "all of these are lifting", and
      // record the ids so the drop shifts them all by one delta. A grab of an
      // unselected event (or a 1-item selection) stays a single-event move.
      const grabbedId = arg.el.closest<HTMLElement>("[data-event-id]")?.dataset.eventId ?? "";
      const sel = selectionRef.current;
      if (grabbedId && sel.has(grabbedId) && sel.size > 1) {
        groupMoveRef.current = [...sel];
        const grid = gridRef.current;
        if (grid) {
          for (const node of grid.querySelectorAll<HTMLElement>("[data-event-id]")) {
            if (!sel.has(node.dataset.eventId ?? "")) continue;
            const h = node.closest<HTMLElement>(
              ".fc-timegrid-event-harness, .fc-daygrid-event-harness"
            );
            if (h && !groupHarnessesRef.current.includes(h)) {
              h.classList.add("is-drag-source");
              groupHarnessesRef.current.push(h);
            }
          }
        }
      } else {
        groupMoveRef.current = [];
      }
      if (followRef.current) followRef.current.style.opacity = "0";
      if (dragRafRef.current == null) traceFollower();
      addPointerSafetyNet(stopDragAffordance, true);
      // Seed copy mode from the modifier already held when the drag began.
      setCopyMode(arg.jsEvent.altKey);
    },
    [addPointerSafetyNet, setCopyMode, stopDragAffordance, traceFollower]
  );

  // RESIZE: edits the event in place (just stretches an edge), so NO follower
  // card and NO source dim — only the grabbing cursor + the safety net. The
  // earlier regression (resize spawned a superposed card) was from routing
  // resize through the move affordance.
  const startResizeAffordance = useCallback(() => {
    document.body.classList.add("is-cal-resizing");
    addPointerSafetyNet(stopDragAffordance);
  }, [addPointerSafetyNet, stopDragAffordance]);

  // Belt-and-braces: never leave the body class / rAF dangling if the component
  // unmounts mid-drag.
  useEffect(() => () => stopDragAffordance(), [stopDragAffordance]);

  const onEventDrop = useCallback(
    (info: EventDropArg) => {
      const existing = events[info.event.id];
      if (!existing || !info.event.start || !requireStaff("move events")) {
        info.revert();
        return;
      }
      const next = fromFcDates(info.event.start, info.event.end, info.event.allDay, existing, snap);
      // GROUP MOVE: the grabbed event was part of a multi-selection. FullCalendar
      // moved only the grabbed one — so compute its delta and apply the SAME
      // date+time shift to every OTHER selected event, committing them all
      // (grabbed + shifted others) as ONE undoable step. Recurring occurrences in
      // the group are treated as predictable single-day moves (no this/following/
      // all dialog — a bulk gesture must be predictable), matching the bulk-delete
      // contract. Copy-drag is single-event only.
      //
      // We read the LIVE selection here, NOT groupMoveRef: FullCalendar fires
      // eventDragStop (→ stopDragAffordance, which clears groupMoveRef) BEFORE
      // eventDrop, so the ref is already empty by the time we run. The selection
      // set is only cleared by a view change / background click / drag-create /
      // Escape — never by a drag-move — so it still holds the multi-selection at
      // drop time, making the group move independent of the affordance's lifecycle.
      const sel = selectionRef.current;
      const groupIds = sel.has(existing.id) && sel.size > 1 ? [...sel] : [];
      if (groupIds.length > 1 && !(info.jsEvent?.altKey || altDragRef.current)) {
        // Revert FC's optimistic single move; we re-commit the whole group from
        // the store so every member (incl. the grabbed one) lands consistently.
        info.revert();
        const delta = moveDelta(existing, next);
        const upserts: CalendarEvent[] = [];
        for (const id of groupIds) {
          const ev = events[id];
          if (!ev) continue;
          // Each member is a date/time shift. On a SERIES member, stamp the move
          // into `custom` (+ origDate) off the PRE-move row so a later regeneration
          // preserves it — a bulk gesture is a durable per-occurrence exception.
          let moved = id === existing.id ? { ...next, updatedAt: Date.now() } : applyMoveDelta(ev, delta, snap);
          if (moved.seriesId) {
            const stamped = applyCustomStamp(ev, ["date", "startMin", "endMin"]);
            moved = { ...moved };
            if (stamped.custom) moved.custom = stamped.custom;
            if (stamped.origDate !== undefined) moved.origDate = stamped.origDate;
          }
          upserts.push(moved);
        }
        if (upserts.length) {
          const before = upserts
            .map((ev) => events[ev.id])
            .filter((ev): ev is CalendarEvent => Boolean(ev));
          commitEvents(upserts, []);
          // Keep the moved set selected so a follow-up nudge/edit stays in scope.
          setSelection(new Set(upserts.map((ev) => ev.id)));
          const count = upserts.length;
          announce("Moved " + count + (count === 1 ? " event" : " events"));
          showToast({
            message: "Moved " + count + (count === 1 ? " event" : " events"),
            onUndo: () => commitEvents(before, []),
          });
        }
        return;
      }
      // Option/Alt held at drop → drop a COPY at the new slot and leave the
      // original untouched (macOS option-drag duplicate). Read at drop time so
      // pressing/releasing Option mid-drag decides copy vs move; altDragRef is the
      // live-tracked fallback when the drop event carries no modifier state.
      if (info.jsEvent?.altKey || altDragRef.current) {
        info.revert();
        const copy: CalendarEvent = { ...next, id: crypto.randomUUID(), updatedAt: Date.now() };
        // A copy is a standalone one-off — shed the series + exception + link
        // bookkeeping so it isn't a phantom member/leg of the original.
        delete copy.seriesId;
        delete copy.recurrence;
        delete copy.custom;
        delete copy.origDate;
        delete copy.linkId;
        upsertEvent(copy);
        announce("Copied " + (existing.title || "event"));
        showToast({
          message: "Copied " + (existing.title || "event"),
          onUndo: () => removeEvent(copy.id),
        });
        return;
      }
      // A repeating occurrence commits "this" INSTANTLY (a per-occurrence
      // exception) with a toast offering [All]/[Following] escalation — no scope
      // dialog. Revert FC's optimistic single-day move first (keeping the
      // revert-before-commit contract): commitThisEdit re-renders the series from
      // the store, so the occurrence lands via the plan, not FC's transient move.
      if (existing.seriesId) {
        info.revert();
        commitThisEditRef.current(existing, next, "Moved");
        return;
      }
      upsertEvent(next);
      announce("Moved " + (existing.title || "event") + " to " + formatClock(next.startMin));
      // Heads-up (never blocking): if this move drops the block into a FRESH
      // same-day kit conflict, say so on an undoable toast so the move is easy to
      // walk back. Quiet when the placement is clean or was already conflicting.
      const warn = placementWarning(existing, next);
      if (warn) {
        showToast({
          message: "Moved " + (existing.title || "event") + warn,
          onUndo: () => upsertEvent(existing),
        });
      }
    },
    [announce, commitEvents, events, placementWarning, removeEvent, requireStaff, showToast, upsertEvent, snap]
  );

  const onEventResize = useCallback(
    (info: EventResizeDoneArg) => {
      const existing = events[info.event.id];
      if (!existing || !info.event.start || !requireStaff("resize events")) {
        info.revert();
        return;
      }
      const next = fromFcDates(info.event.start, info.event.end, info.event.allDay, existing, snap);
      // Resizing a repeating occurrence commits "this" instantly with an escalation
      // toast, mirroring the drag and the editor save — no scope dialog.
      if (existing.seriesId) {
        info.revert();
        commitThisEditRef.current(existing, next, "Resized");
        return;
      }
      upsertEvent(next);
      announce((existing.title || "Event") + " now ends at " + formatClock(next.endMin));
      // A resize that stretches a block INTO a fresh overlap can create a kit
      // conflict too — same informational, undoable heads-up as a drop.
      const warn = placementWarning(existing, next);
      if (warn) {
        showToast({
          message: (existing.title || "Event") + " resized" + warn,
          onUndo: () => upsertEvent(existing),
        });
      }
    },
    [announce, events, placementWarning, requireStaff, showToast, upsertEvent, snap]
  );

  const onEventReceive = useCallback(
    (info: EventReceiveArg) => {
      const activityId = String(info.event.extendedProps.activityId ?? "");
      const activity = byId[activityId];
      const start = info.event.start;
      // Our store is the source of truth — drop FC's temporary event either way.
      info.event.remove();
      if (!start || !requireStaff("plan the calendar")) return;
      const date = toDateKey(start);
      const duration = snapDurationMin(activity?.durationMin ?? DEFAULT_DURATION_MIN);

      // A month-cell drop means "put it on this day", not "make it all-day":
      // place it at the day's next free time like the tap-to-place flow.
      let allDay = info.event.allDay;
      let startMin = allDay ? 0 : snapMinutes(minutesOfDay(start), snap);
      const monthDrop = allDay && info.view.type === "dayGridMonth";
      if (monthDrop) {
        const dayEvents = healedEvents.filter((event) => event.date === date);
        const freeStart = nextFreeStartForDay(dayEvents, duration, DEFAULT_PLANNING_START_MIN, window_);
        if (freeStart != null) {
          allDay = false;
          startMin = freeStart;
        }
      }

      const event: CalendarEvent = {
        id: crypto.randomUUID(),
        date,
        startMin: allDay ? 0 : startMin,
        endMin: allDay ? 0 : Math.min(MINUTES_PER_DAY, startMin + duration),
        kind: activity ? "activity" : "custom",
        title: activity?.title ?? info.event.title ?? "Untitled",
        updatedAt: Date.now(),
      };
      if (activity) event.activityId = activity.id;
      if (allDay) event.allDay = true;
      upsertEvent(event);
      announce(event.title + " scheduled at " + (event.allDay ? "all day" : formatClock(event.startMin)));
      // Month cells hide times, so say where the event actually landed.
      if (monthDrop) {
        showToast(
          {
            message: event.allDay
              ? event.title + " added as all-day — no open time " + formatEventDateLabel(date)
              : event.title + " — added " + formatEventDateLabel(date) + " · " + formatClock(event.startMin),
            onUndo: () => removeEvent(event.id),
          },
          8000
        );
      }
    },
    [announce, byId, healedEvents, removeEvent, requireStaff, showToast, upsertEvent, window_, snap]
  );

  // Tint flows through a CSS variable so the stylesheet can mix it with paper.
  const onEventDidMount = useCallback((info: EventMountArg) => {
    // Background events (guidance bands + closed-day shading) are non-interactive:
    // don't stamp a data-event-id (they aren't in the store, so the contextmenu /
    // selection resolvers would otherwise dead-end on their id and swallow a
    // click). Their pointer-events are off in CSS so a click lands on the grid.
    if (info.event.display === "background") return;
    const tint = info.event.extendedProps.tint;
    if (typeof tint === "string") info.el.style.setProperty("--cal-tint", tint);
    // The theme tint rides a second channel so the badge dot can carry the
    // theme color without disturbing the category spine (--cal-tint).
    const themeTint = info.event.extendedProps.themeTint;
    if (typeof themeTint === "string") info.el.style.setProperty("--theme-tint", themeTint);
    // Stamp the id so the delegated contextmenu listener can resolve the event
    // from FullCalendar's (non-React) event DOM.
    info.el.dataset.eventId = info.event.id;
  }, []);

  const renderEventContent = useCallback((arg: EventContentArg) => {
    // Background events (guidance bands + closed-day shading) render through THIS
    // same generator in FC v6 (EventContainer's customGenerator runs for bg segs).
    // A band shows a small, quiet inline label riding on the wash; the closed
    // shade is a plain wash with no content. Both are non-interactive; a click
    // passes through to dateClick (FC excepts .fc-bg-event from its block list).
    const bgKind = arg.event.extendedProps.bgKind;
    if (bgKind === "band") {
      return arg.event.title ? (
        <div className="cal-band__inner" title={arg.event.title}>
          <span className="cal-band__label">{arg.event.title}</span>
        </div>
      ) : null;
    }
    if (bgKind === "closed") return null;

    // A secondary theme dot, drawn only when the event's activity carries a
    // theme. The category color stays the spine (--cal-tint); theme is an
    // accent dot, never a replacement, and is labelled so it never reads as
    // color-alone. Skipped on dense month chips, which already carry a tick.
    const themeLabel = arg.event.extendedProps.themeLabel;
    const dot =
      typeof themeLabel === "string" && themeLabel ? (
        <span className="cal-card__theme" title={"Theme: " + themeLabel} aria-label={"Theme: " + themeLabel} />
      ) : null;
    // A small loop glyph marks a recurring event — the traditional calendar
    // affordance. Only rendered when the event repeats, so non-repeating cards
    // (and the visual baselines) are untouched.
    const repeats = arg.event.extendedProps.repeats === true;
    // A pinned event (held in place when a day-shift moves the rest of the day)
    // carries a small pin glyph beside the recurrence loop. Threaded through the
    // adapter's extendedProps like `repeats`, so it repaints on every data change.
    const pinned = arg.event.extendedProps.pinned === true;
    // A "this"-customized series member carries a small "edited" tick beside the
    // repeat loop — the visible mark of a per-occurrence exception (rule 5).
    const customized = arg.event.extendedProps.customized === true;
    // A split-day leg ("1/2 · 2/2") — one leg of a same-day linked pair (rule 8).
    const legLabelRaw = arg.event.extendedProps.legLabel;
    const legLabel = typeof legLabelRaw === "string" && legLabelRaw ? legLabelRaw : null;
    const tint = arg.event.extendedProps.tint;
    const themeTint = arg.event.extendedProps.themeTint;
    const isCustom = arg.event.extendedProps.kind === "custom";
    // camps-2/J2: a small neutral "shared" badge on any event that shows under
    // EVERY camp (no campId of its own) while a specific camp is active — so
    // switching camps reads as "most of the calendar predates camps" rather
    // than "the switcher does nothing." Quiet by design (a plain glyph, no
    // color), distinct from the backup badge which carries real signal.
    const shared = arg.event.extendedProps.shared === true;
    const sharedBadge = shared ? (
      <span
        className="cal-card__shared"
        title="Shown under every camp (not assigned to one)"
        aria-label="Shared across every camp"
      >
        <CampIcon.Users />
      </span>
    ) : null;
    // Where the block happens (gym, field…), shown under the time on taller
    // cards. The card is a size container, so a short block simply clips it.
    const locationText = arg.event.extendedProps.location;
    const location = typeof locationText === "string" && locationText ? locationText : null;
    // A backup-plan badge: a small corner glyph when this placement resolves to
    // any alternate (event override ?? activity default) — an umbrella when any is
    // a rain plan, else a generic swap; the count rides when more than one.
    const altGlyphRaw = arg.event.extendedProps.alternatesGlyph as AlternatesGlyph | undefined;
    const altBadge = altGlyphRaw ? (
      <span
        className="cal-card__backup"
        title={
          altGlyphRaw.count +
          " backup plan" +
          (altGlyphRaw.count === 1 ? "" : "s") +
          (altGlyphRaw.rain ? " (rain)" : "")
        }
        aria-label={altGlyphRaw.count + " backup plan" + (altGlyphRaw.count === 1 ? "" : "s")}
      >
        {altGlyphRaw.rain ? <BackupUmbrellaGlyph /> : <CampIcon.Repeat />}
        {altGlyphRaw.count > 1 && <span className="cal-card__backup-n">{altGlyphRaw.count}</span>}
      </span>
    ) : null;

    // Repaint + distinction, written from HERE rather than eventDidMount: this
    // content renderer re-runs on every data change (a recolor, or an activity→
    // custom heal), whereas eventDidMount fires once — so the color and the
    // activity/custom spine update immediately instead of waiting for a refresh.
    const paint = (node: HTMLElement | null) => {
      const el = node?.closest(".fc-event") as HTMLElement | null;
      if (!el) return;
      if (typeof tint === "string") el.style.setProperty("--cal-tint", tint);
      if (typeof themeTint === "string") el.style.setProperty("--theme-tint", themeTint);
      // Custom (lunch/assembly/free-play) events wear a hatched spine; activities
      // keep the solid category spine. (CSS in calendar.css §event distinction.)
      el.classList.toggle("cal-event--custom", isCustom);
    };

    if (arg.view.type === "dayGridMonth") {
      // One left spine carries the category colour (the .fc-daygrid-event
      // border-left); no inner tick on top of it.
      return (
        <div className="cal-chip" ref={paint}>
          {!arg.event.allDay && <span className="cal-chip__time">{arg.timeText}</span>}
          <span className="cal-chip__title">{arg.event.title}</span>
          {legLabel && <span className="cal-chip__leg">{legLabel}</span>}
          {altBadge}
          {sharedBadge}
          {pinned && <CardPinGlyph className="cal-chip__pin" />}
          {repeats && <CampIcon.Repeat className="cal-chip__repeat" />}
          {customized && <EditedTickGlyph className="cal-chip__edited" />}
        </div>
      );
    }
    // One structure for every timed block. The card is a size container (see
    // calendar.css), so it recalibrates its own layout from its LIVE rendered
    // height — collapsing a stacked title + time onto one Google-style line the
    // instant a resize makes the block too short, and back — instead of
    // branching here on a stored duration that only updated when the drag dropped.
    // The theme dot rides in .cal-card__line so it stays beside the title in
    // both the stacked and the collapsed layouts.
    return (
      <div className="cal-card" ref={paint}>
        <span className="cal-card__line">
          {dot}
          <span className="cal-card__title">{arg.event.title}</span>
          {legLabel && <span className="cal-card__leg">{legLabel}</span>}
          {altBadge}
          {sharedBadge}
          {pinned && <CardPinGlyph className="cal-card__pin" />}
          {repeats && <CampIcon.Repeat className="cal-card__repeat" />}
          {customized && <EditedTickGlyph className="cal-card__edited" />}
        </span>
        {!arg.event.allDay && <span className="cal-card__time">{arg.timeText}</span>}
        {location && (
          <span className="cal-card__loc">
            <CampIcon.Pin className="cal-card__locpin" />
            <span className="cal-card__loctext">{location}</span>
          </span>
        )}
      </div>
    );
    // Stable: the callback reads only per-event extendedProps and module-level
    // glyphs, so it never needs to re-arm on a state change.
  }, []);

  // Paint the multi-selection onto FullCalendar's (non-React) event DOM. The
  // cards aren't ours to render a className onto, so — like the contextmenu id
  // stamp and the drag-source dimming — we reach into the grid and toggle a
  // DEDICATED class (cal-event--selected, NOT FC's own .fc-event-selected, which
  // its native single-select ring would clash with) on every [data-event-id]
  // harness to match the set. Re-runs whenever the selection changes OR fcEvents
  // rebuilds the DOM (a recolor / add / remove / heal) or the view changes,
  // deferred a frame so it lands after FC has committed its render. The same id
  // can appear on more than one node (a strip/month overlap), so we walk ALL
  // matching nodes.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const frame = window.requestAnimationFrame(() => {
      grid.querySelectorAll<HTMLElement>("[data-event-id]").forEach((el) => {
        el.classList.toggle("cal-event--selected", selection.has(el.dataset.eventId ?? ""));
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selection, fcEvents, activeView]);

  // "Day" weather rides in the column header; bump renderDayHeader's identity only
  // when the daily forecast changes AND we're in day mode (so a Month view or the
  // hourly mode never re-renders the grid for weather). The map + units are read
  // fresh from the ref so the value itself isn't a memo dep.
  const dayWxVersion = weatherMode === "day" ? weatherData?.version ?? 0 : 0;

  // The rain lens rides the day-header weather summary, so it needs its own
  // identity bump when a day's rain plan appears / clears / changes count (a
  // promote, a move, a threshold change). rainPlanByDate is read LIVE from its ref
  // inside renderDayHeader — this signature re-arms the FC header only when a
  // lens would actually change, not on every recompute.
  const rainChipVersion = useMemo(() => {
    let sig = "";
    for (const [date, plan] of rainPlanByDate) {
      sig += date + ":" + Math.round(plan.probMax) + "x" + plan.rows.length + "|";
    }
    return sig;
  }, [rainPlanByDate]);

  // The Gather chip rides in the timed-view column header too, so it needs the
  // same identity bump when the day contention changes (a stock edit, a move, a
  // new event). dayKitByDate is read LIVE from its ref inside renderDayHeader —
  // this signature (does any day have items / a warning / a hard conflict) re-arms
  // the FC header only when the CHIP would actually change, not on every recompute.
  const kitChipVersion = useMemo(() => {
    let sig = "";
    for (const [date, day] of dayKitByDate) {
      if (!day.items.length) continue;
      sig +=
        date +
        (day.hardConflicts.length ? "r" : day.softWarnings.length ? "a" : "q") +
        day.items.length +
        "|";
    }
    return sig;
  }, [dayKitByDate]);

  // Google-style day headers: "MON" over the date numeral, today circled — plus,
  // in "Day" weather mode, a small forecast summary (glyph + high/low) that opens
  // the detail card on click.
  const renderDayHeader = useCallback(
    (arg: DayHeaderContentArg) => {
      const weekday = arg.date.toLocaleDateString(undefined, { weekday: "short" });
      if (arg.view.type === "dayGridMonth") {
        // Month headers are days-of-week, not real dates. FullCalendar's arg.date
        // there is a fixed Sunday-based reference week, so recomputing the weekday
        // from it lands one column behind once firstDay rotates the columns (the
        // pre-existing "Sun-month" label bug). arg.dow is the column's true
        // day-of-week — the same basis as its fc-day-* class — so label from that
        // off a known Sunday (Jan 7 2024) to stay locale-correct and firstDay-safe.
        const dowName = new Date(2024, 0, 7 + arg.dow).toLocaleDateString(undefined, {
          weekday: "short",
        });
        return <span className="cal-dayhead__dow">{dowName}</span>;
      }
      const dateKey = `${arg.date.getFullYear()}-${String(arg.date.getMonth() + 1).padStart(2, "0")}-${String(
        arg.date.getDate()
      ).padStart(2, "0")}`;
      const dayWx = weatherMode === "day" ? weatherDataRef.current?.daily.get(dateKey) : undefined;
      // The day's Rain Review, read live from the ref (so a recompute doesn't
      // re-arm this FC memo). When present it tints the weather summary and swaps
      // its click from the plain weather card to the Rain Review panel — composed
      // INTO the existing weather element, not a separate chip.
      const rain = rainPlanByDateRef.current.get(dateKey);
      // The day's kit contention (read live from the ref so a recompute doesn't
      // re-arm this FC memo). The chip renders only when the day needs at least
      // one material; its tone escalates quiet → amber (soft warning) → red (hard
      // conflict), and clicking it opens the Gather popover.
      const kit = dayKitByDateRef.current.get(dateKey);
      const kitTone = !kit || !kit.items.length
        ? null
        : kit.hardConflicts.length
          ? "red"
          : kit.softWarnings.length
            ? "amber"
            : "quiet";
      const kitCount = kit?.items.length ?? 0;
      return (
        <div
          className={
            "cal-dayhead" + (arg.isToday ? " is-today" : "") + (dayWx ? " cal-dayhead--wx" : "")
          }
        >
          <span className="cal-dayhead__dow">{weekday}</span>
          <span className="cal-dayhead__num">{arg.date.getDate()}</span>
          {dayWx && (
            <button
              type="button"
              className={"cal-wx-day" + (rain ? " cal-wx-day--rain" : "")}
              data-wx-cond={dayWx.condition}
              aria-label={
                rain
                  ? `${Math.round(rain.probMax)}% rain — ${rain.rows.length} outdoor block${
                      rain.rows.length === 1 ? "" : "s"
                    } at risk. Open Rain Review`
                  : `${conditionLabel(dayWx.condition)} — high ${formatTemp(dayWx.tempMax)}, low ${formatTemp(
                      dayWx.tempMin
                    )}. View detail`
              }
              onClick={(e) => {
                e.stopPropagation();
                // The rain lens takes priority: it's the actionable surface. With
                // no rain plan the summary keeps its plain weather-detail card.
                if (rainPlanByDateRef.current.get(dateKey)) {
                  openRainRef.current(dateKey as DateKey, e.currentTarget.getBoundingClientRect());
                } else {
                  openWxRef.current(
                    { kind: "day", date: dateKey, weather: dayWx },
                    e.currentTarget.getBoundingClientRect()
                  );
                }
              }}
            >
              <WeatherGlyph condition={dayWx.condition} className="cal-wx-day__glyph" />
              <span className="cal-wx-day__temps">
                <span className="cal-wx-day__hi">{formatTemp(dayWx.tempMax)}</span>
                <span className="cal-wx-day__lo">{formatTemp(dayWx.tempMin)}</span>
              </span>
              {rain && <BackupUmbrellaGlyph className="cal-wx-day__rain" />}
            </button>
          )}
          {kitTone && (
            <button
              type="button"
              className={"cal-kit-chip cal-kit-chip--" + kitTone}
              aria-label={
                (kitTone === "red"
                  ? "Kit conflict"
                  : kitTone === "amber"
                    ? "Kit warning"
                    : "Gather") +
                ` — ${kitCount} material${kitCount === 1 ? "" : "s"} needed. View gather list`
              }
              onClick={(e) => {
                e.stopPropagation();
                openGatherRef.current(dateKey as DateKey, e.currentTarget.getBoundingClientRect());
              }}
            >
              <KitGlyph className="cal-kit-chip__glyph" />
            </button>
          )}
        </div>
      );
    },
    // weatherDataRef + dayKitByDateRef + rainPlanByDateRef are read live;
    // dayWxVersion / kitChipVersion / rainChipVersion re-arm only when the weather,
    // the kit chip, or the rain lens would actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weatherMode, dayWxVersion, kitChipVersion, rainChipVersion]
  );

  // Size the day columns so the active zoom (1 / 7 / N days) fits the viewport:
  // day width = (grid width − padding − time gutter) / target days. We set the
  // strip's total width as a CSS var (gutter + dayW × STRIP) and remember the
  // measured day width for the scroll math.
  const recomputeDayWidth = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cs = getComputedStyle(grid);
    const padL = parseFloat(cs.paddingLeft || "0");
    const padX = padL + parseFloat(cs.paddingRight || "0");
    const axis = grid.querySelector<HTMLElement>(".fc-timegrid-axis");
    const gutter = axis ? axis.getBoundingClientRect().width : 52;
    const avail = grid.clientWidth - padX - gutter;
    const w = Math.max(MIN_DAY_WIDTH, avail / targetDaysRef.current);
    // Remember the canonical width so a vertical-zoom nudge can toggle off it
    // without drifting (it always re-bases here on resize / horizontal zoom).
    stripWidthRef.current = Math.round(gutter + w * STRIP_DAYS);
    grid.style.setProperty("--cal-strip-w", stripWidthRef.current + widthNudgeRef.current + "px");
    // scroll-snap aligns a day's start to the scrollport's border edge; offsetting
    // snap by the padding + gutter lands days at the gutter's RIGHT edge (where
    // they're visible), matching our programmatic scroll so the two never fight.
    grid.style.setProperty("--cal-gutter", Math.round(padL + gutter) + "px");
    // The all-day row pins just below the day-name header — feed it the header's
    // measured height so the offset is exact regardless of font/zoom.
    const head = grid.querySelector<HTMLElement>(".fc-scrollgrid-section-header");
    if (head) grid.style.setProperty("--cal-headh", Math.round(head.getBoundingClientRect().height) + "px");
    // FullCalendar caches its column widths and does NOT notice the CSS
    // min-width change on its own — without this it only re-lays-out when some
    // OTHER prop (e.g. a new event) forces a re-render. updateSize() makes it
    // re-measure now so a zoom / resize takes effect immediately.
    calendarRef.current?.getApi().updateSize();
    setDayWidth(w);
  }, []);

  // Debounce flushing the settled pinch zoom to localStorage so a live gesture
  // (which mutates slotZoomRef + the CSS var every frame) doesn't thrash storage.
  const persistSlotZoom = useCallback(
    (zoom: number) => {
      if (slotZoomPersistRef.current != null) window.clearTimeout(slotZoomPersistRef.current);
      slotZoomPersistRef.current = window.setTimeout(() => setSlotZoom(zoom), 200);
    },
    [setSlotZoom]
  );

  // The dynamic minimum zoom: the smallest zoom at which the day still fills the
  // scroll viewport (header + all-day + slots ≥ the visible height), so the user can
  // never shrink it into blank space — the grid stays hard-blocked top and bottom.
  // We size the slot body analytically — slotCount × 1.3em (the un-floored base
  // height from calendar.css) — rather than from the live body measurement: at the
  // densest zooms the empty rows hit their line-box floor and read TALLER than the
  // linear base, so extrapolating from a measured body would under-shoot the fit and
  // re-introduce a sliver of blank space. The analytic base errs the safe way (the
  // real grid is always ≥ this, so the fit is exact normally and a touch
  // conservative at the extreme).
  const computeMinZoom = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return SLOT_ZOOM_FLOOR;
    const fc = grid.querySelector<HTMLElement>(".fc");
    const tg = grid.querySelector<HTMLElement>(".fc-timegrid-body");
    if (!fc || !tg) return SLOT_ZOOM_FLOOR;
    const viewH = grid.clientHeight;
    if (viewH <= 0) return SLOT_ZOOM_FLOOR;
    const nonBody = Math.max(0, fc.getBoundingClientRect().height - tg.getBoundingClientRect().height);
    const slotCount = Math.max(1, Math.round((gridEnd - gridStart) / 15)); // 15-min slots
    const emPx = parseFloat(getComputedStyle(fc).fontSize) || 15;
    const bodyAtZoom1 = slotCount * 1.3 * emPx; // matches calc(1.3em) in calendar.css
    const fit = (viewH - nonBody) / bodyAtZoom1;
    // Never below the sanity floor, never above the zoom-in cap (so an absurdly tall
    // viewport just locks the zoom rather than inverting the clamp).
    return Math.min(SLOT_ZOOM_MAX, Math.max(SLOT_ZOOM_FLOOR, fit));
  }, [gridStart, gridEnd]);

  // Apply a new vertical zoom to the timed strip, keeping the time at the anchor
  // (viewport centre for a trackpad pinch; the finger midpoint for touch) fixed —
  // Google/Notion-style anchored zoom. We scale the base slot height via the
  // --cal-slot-zoom var, let FullCalendar re-measure event coordinates
  // (updateSize), then nudge scrollTop so the anchor point lands back in place. The
  // grid (.calshell__grid--strip) is itself the scroller, so scrollTop math is
  // against it directly. The new zoom is clamped to [fit-to-viewport, max].
  const applySlotZoom = useCallback(
    (next: number, anchorClientY?: number) => {
      const grid = gridRef.current;
      if (!grid || !grid.classList.contains("calshell__grid--strip")) return;
      const zoom = Math.min(SLOT_ZOOM_MAX, Math.max(computeMinZoom(), next));
      if (Math.abs(zoom - slotZoomRef.current) < 0.0005) return;
      const body = grid.querySelector<HTMLElement>(".fc-timegrid-body");
      // Fraction of the day-body the anchor sits over, measured BEFORE the resize.
      let frac: number | null = null;
      if (body && anchorClientY != null) {
        const r = body.getBoundingClientRect();
        if (r.height > 0 && anchorClientY > r.top) {
          frac = Math.min(1, (anchorClientY - r.top) / r.height);
        }
      }
      slotZoomRef.current = zoom;
      grid.style.setProperty("--cal-slot-zoom", String(zoom));
      // Flip the 1px width nudge so FC's next updateSize() re-measures clientWidth
      // and recomputes slat coordinates — otherwise the event cards keep the pixel
      // positions from the previous zoom and detach from the grid. Re-base off the
      // canonical width (falling back to the current var on first run).
      widthNudgeRef.current = widthNudgeRef.current ? 0 : 1;
      const baseW =
        stripWidthRef.current || parseFloat(grid.style.getPropertyValue("--cal-strip-w")) || 0;
      if (baseW) grid.style.setProperty("--cal-strip-w", baseW + widthNudgeRef.current + "px");
      calendarRef.current?.getApi().updateSize();
      // Re-anchor: getBoundingClientRect forces the layout with the new height, so
      // r2 reflects the scaled body — shift scrollTop so the same fraction lands
      // back under the anchor.
      if (frac != null && body && anchorClientY != null) {
        const r2 = body.getBoundingClientRect();
        grid.scrollTop += r2.top - (anchorClientY - frac * r2.height);
      }
      persistSlotZoom(zoom);
    },
    [computeMinZoom, persistSlotZoom]
  );

  // Pull the zoom back up to the fit-to-viewport minimum if it's currently below it
  // (e.g. the window grew, or a stored value predates a taller layout) — keeping the
  // grid hard-blocked with no blank space. No-op when already at/above the floor.
  const enforceZoomFloor = useCallback(() => {
    const grid = gridRef.current;
    if (!grid || !grid.classList.contains("calshell__grid--strip")) return;
    const min = computeMinZoom();
    if (slotZoomRef.current < min - 0.0005) applySlotZoom(min);
  }, [computeMinZoom, applySlotZoom]);

  // Live scroll → header title / mini-month band / Today state (throttled), plus
  // a settle hook that re-anchors the strip when it nears an edge (endless feel).
  const onGridScroll = useCallback(() => {
    if (scrollRafRef.current == null) {
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        syncVisible();
      });
    }
    if (scrollSettleRef.current != null) window.clearTimeout(scrollSettleRef.current);
    scrollSettleRef.current = window.setTimeout(() => {
      const start = stripStartRef.current;
      // Don't re-anchor until the first paint has positioned the strip on today,
      // otherwise the initial scroll-at-the-edge triggers a re-anchor loop.
      if (!start || !didInitialScrollRef.current) return;
      const firstKey = firstVisibleDay();
      const idx = daySpan(start, firstKey);
      const lastStart = STRIP_DAYS - targetDaysRef.current;
      if (idx < REANCHOR_MARGIN || idx > lastStart - REANCHOR_MARGIN) {
        keepDayRef.current = firstKey;
        setStripStart(addDays(firstKey, -Math.floor((STRIP_DAYS - targetDaysRef.current) / 2)));
        return;
      }
      // Settle-snap: once the scroll stops, gently align the nearest day to the
      // left edge so a day is never left half cut off (the deadzone in
      // scrollDayToLeft stops this from looping when it's already aligned).
      scrollDayToLeft(firstKey, "smooth");
    }, 140);
  }, [firstVisibleDay, scrollDayToLeft, syncVisible]);

  // Re-align the strip so `day` ends up exactly at the left edge, resilient to
  // FullCalendar finishing its layout a beat after the scroll (it nudges the
  // columns when the all-day row / events settle, which would otherwise leave a
  // day half cut off). We align across a couple of frames and a short timeout.
  const realignTo = useCallback(
    (day: DateKey) => {
      const run = () => {
        if (!stripStartRef.current) return;
        scrollDayToLeft(day, "auto");
        lastFirstDayRef.current = null;
        syncVisible();
      };
      // A couple of animation frames, then a few timed passes — the delta-based
      // scroll converges as FullCalendar finishes laying the grid out (the
      // all-day row / events settle a beat after the first paint).
      requestAnimationFrame(() => {
        run();
        requestAnimationFrame(run);
      });
      window.setTimeout(run, 120);
      window.setTimeout(run, 320);
    },
    [scrollDayToLeft, syncVisible]
  );

  // Recompute the day width on viewport resize, keeping the leftmost day put
  // (only once the first paint has landed on today).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const ro = new ResizeObserver(() => {
      if (didInitialScrollRef.current) keepDayRef.current = firstVisibleDay();
      recomputeDayWidth();
      // A taller viewport raises the fit-to-viewport floor — pull the zoom up so a
      // resize never reveals blank space below the last hour.
      enforceZoomFloor();
    });
    ro.observe(grid);
    return () => ro.disconnect();
  }, [firstVisibleDay, recomputeDayWidth, enforceZoomFloor]);

  // Recompute the day width when the zoom (target days) changes.
  useEffect(() => {
    recomputeDayWidth();
  }, [targetDays, recomputeDayWidth]);

  // Apply the persisted / hydrated vertical zoom to the grid var. The var-set is
  // skipped when a live pinch already set it (so the debounced persist that follows
  // a gesture doesn't trigger a redundant re-measure), but the floor is always
  // enforced. Runs on mount (var → 1) and once the stored value hydrates in.
  useEffect(() => {
    slotZoomRef.current = slotZoom;
    const grid = gridRef.current;
    if (!grid) return;
    if (grid.style.getPropertyValue("--cal-slot-zoom") !== String(slotZoom)) {
      grid.style.setProperty("--cal-slot-zoom", String(slotZoom));
      // Same width nudge as the live pinch so the hydrated/programmatic zoom also
      // re-measures FC's slat coords → events land at their correct height on load,
      // independent of whether recomputeDayWidth has run yet.
      widthNudgeRef.current = widthNudgeRef.current ? 0 : 1;
      const baseW =
        stripWidthRef.current || parseFloat(grid.style.getPropertyValue("--cal-strip-w")) || 0;
      if (baseW) grid.style.setProperty("--cal-strip-w", baseW + widthNudgeRef.current + "px");
      calendarRef.current?.getApi().updateSize();
    }
    // A stored value can be below this layout's fit-to-viewport floor (e.g. saved on
    // a shorter window) — pull it up so load never shows blank space.
    enforceZoomFloor();
  }, [slotZoom, enforceZoomFloor]);

  // Once the strip has measured (dayWidth is set only after FullCalendar lays out)
  // — and on every horizontal zoom / resize that re-measures it — re-assert the
  // fit-to-viewport floor. This is the reliable "FC is ready" hook for the initial
  // load, where the hydration effect can run a beat before the grid is laid out.
  useEffect(() => {
    if (dayWidth > 0) enforceZoomFloor();
  }, [dayWidth, enforceZoomFloor]);

  // Pinch-to-zoom the hour height. A trackpad pinch arrives as a ctrl-modified
  // wheel event (also catches ctrl+wheel on a mouse); two-finger touch is handled
  // directly. Native, non-passive listeners so we can preventDefault the browser's
  // page-zoom / pan. Attached to the grid div (stable across Month↔strip); the
  // handlers no-op unless the timed strip is mounted.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return; // plain scroll / two-finger pan → leave alone
      if (!grid.classList.contains("calshell__grid--strip")) return;
      event.preventDefault();
      // Clamp so a chunky mouse-wheel notch doesn't jump octaves; a trackpad
      // pinch sends small pixel deltas and stays smooth.
      const dy = Math.max(-40, Math.min(40, event.deltaY));
      // Anchor a trackpad/wheel zoom at the viewport's vertical centre rather than
      // the cursor: the cursor position is incidental to a pinch and made the grid
      // lurch toward an off-centre point, which felt off. Centre expansion reads as
      // calm and symmetric. (Touch keeps the finger midpoint — see onTouchMove.)
      const rect = grid.getBoundingClientRect();
      applySlotZoom(slotZoomRef.current * Math.exp(-dy * 0.01), rect.top + rect.height / 2);
    };

    let pinching = false;
    let baseDist = 0;
    let baseZoom = 1;
    const twoDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const twoMidY = (t: TouchList) => (t[0].clientY + t[1].clientY) / 2;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      if (!grid.classList.contains("calshell__grid--strip")) return;
      pinching = true;
      baseDist = twoDist(event.touches);
      baseZoom = slotZoomRef.current;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinching || event.touches.length !== 2) return;
      event.preventDefault(); // own the two-finger gesture; one-finger pan untouched
      const dist = twoDist(event.touches);
      if (baseDist > 0) applySlotZoom(baseZoom * (dist / baseDist), twoMidY(event.touches));
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinching = false;
    };

    grid.addEventListener("wheel", onWheel, { passive: false });
    grid.addEventListener("touchstart", onTouchStart, { passive: true });
    grid.addEventListener("touchmove", onTouchMove, { passive: false });
    grid.addEventListener("touchend", onTouchEnd, { passive: true });
    grid.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      grid.removeEventListener("wheel", onWheel);
      grid.removeEventListener("touchstart", onTouchStart);
      grid.removeEventListener("touchmove", onTouchMove);
      grid.removeEventListener("touchend", onTouchEnd);
      grid.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [applySlotZoom]);

  // Flush any pending zoom-persist timer on unmount.
  useEffect(
    () => () => {
      if (slotZoomPersistRef.current != null) window.clearTimeout(slotZoomPersistRef.current);
    },
    []
  );

  // After any width change (zoom / resize / first paint), re-align the scroll so
  // the intended day sits at the left edge. First paint always lands on today.
  useEffect(() => {
    if (!dayWidth || !stripStartRef.current) return;
    let day = keepDayRef.current;
    keepDayRef.current = null;
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      day = todayKey();
      // The strip has measured and we're about to land on today — the grid is
      // settled enough to reveal. Signal readiness so the host can drop the veil.
      fireReady();
    }
    if (day) realignTo(day);
  }, [dayWidth, realignTo, fireReady]);

  // Month is laid out on its first paint (no horizontal day-width measure, so the
  // strip's readiness path above never runs for it). Once the client-resolved view
  // has mounted as Month, defer one frame past commit so the grid has painted,
  // then signal readiness. fireReady is idempotent, so a later switch to the strip
  // (which also calls it) is a no-op.
  useEffect(() => {
    if (resolvedView !== "dayGridMonth" || firedReadyRef.current) return;
    const id = requestAnimationFrame(() => fireReady());
    return () => cancelAnimationFrame(id);
  }, [resolvedView, fireReady]);

  // When the strip re-anchors (or we re-enter it from Month), move FullCalendar's
  // rendered window and re-align the scroll so the view doesn't visibly jump.
  useEffect(() => {
    if (!stripStart) return;
    // The initial mount already renders + positions the strip (see the day-width
    // effect, which lands on today); skip this effect's first run so it doesn't
    // fight that by re-aligning to the scroll-0 day.
    if (stripFirstRunRef.current) {
      stripFirstRunRef.current = false;
      return;
    }
    const api = calendarRef.current?.getApi();
    if (!api || api.view.type !== "timeGridStrip") return;
    const day = keepDayRef.current ?? firstVisibleDay();
    keepDayRef.current = null;
    // Defer the gotoDate out of React's commit phase: FullCalendar re-renders the
    // strip (height:auto → internal flushSync) and doing that mid-commit triggers
    // React's "flushSync inside a lifecycle" churn. A macrotask detaches it; the
    // realign then keeps the same day in view so there's no visible jump.
    const id = window.setTimeout(() => {
      api.gotoDate(fromDateKey(stripStart));
      realignTo(day);
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripStart]);

  // Feed the live time into the Notion-style now-indicator pill: a --now-time CSS
  // var on the grid that .fc-timegrid-now-indicator-line::after renders. Set on
  // mount and every minute so the pill stays current (the indicator only paints
  // when now is within the visible window, so an off-hours pill never shows).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => {
      const now = new Date();
      let h = now.getHours();
      const ampm = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
      const label = h + ":" + String(now.getMinutes()).padStart(2, "0") + " " + ampm;
      grid.style.setProperty("--now-time", JSON.stringify(label));
    };
    update();
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // FC only draws its now-line in today's column; mirror it with a full-width
  // overlay (.cal-nowline) inside .fc-timegrid-cols so the current-time line is
  // persistent across every day in Week view too. Inside the cols it's exactly the
  // content width (never widens the horizontal scroll) and scrolls with the grid;
  // we just keep its y synced to FC's own line on layout changes / scroll / a slow
  // tick for minute drift. Re-runs per view (Month has no timegrid → it self-clears).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;
    const sync = () => {
      const fcLine = grid.querySelector<HTMLElement>(".fc-timegrid-now-indicator-line");
      const cols = grid.querySelector<HTMLElement>(".fc-timegrid-cols");
      let overlay = grid.querySelector<HTMLElement>(".cal-nowline");
      if (!fcLine || !cols) {
        overlay?.remove();
        return;
      }
      if (!overlay || overlay.parentElement !== cols) {
        overlay?.remove();
        overlay = document.createElement("div");
        overlay.className = "cal-nowline";
        overlay.setAttribute("aria-hidden", "true");
        cols.appendChild(overlay);
      }
      const colsRect = cols.getBoundingClientRect();
      // Centre the thin overlay on the thick line's MIDPOINT (not its top edge), so
      // the cross-day line connects through the centre of today's bold segment.
      const fcRect = fcLine.getBoundingClientRect();
      const overlayH = overlay.getBoundingClientRect().height || 1;
      overlay.style.top = fcRect.top + fcRect.height / 2 - overlayH / 2 - colsRect.top + "px";
      // Anchor the line's distance fade (see .cal-nowline) on today's column:
      // brightest at its centre, easing out over ~5 columns each side to a faint
      // floor. Both depend on the live column widths (the strip re-zooms per
      // view), so we measure here and feed the gradient via CSS vars.
      const todayCol = grid.querySelector<HTMLElement>(".fc-timegrid-col.fc-day-today");
      if (todayCol) {
        const todayRect = todayCol.getBoundingClientRect();
        const centerPx = todayRect.left + todayRect.width / 2 - colsRect.left;
        grid.style.setProperty("--now-c", centerPx.toFixed(1) + "px");
        grid.style.setProperty("--now-spread", (todayRect.width * 5).toFixed(1) + "px");
      }
      // Notion-style: when the now-time pill (FC's gutter arrow) overlaps an hour
      // label, hide that label entirely — the pill already shows the time, so a
      // half-covered "12 PM" peeking out reads as a glitch. Measure overlap live
      // (handles any zoom) and toggle visibility (keeps the cell's box so the
      // gutter width doesn't jump); no pill (today off-screen) → all labels show.
      const pill = grid.querySelector<HTMLElement>(".fc-timegrid-now-indicator-arrow");
      const pillRect = pill?.getBoundingClientRect();
      grid.querySelectorAll<HTMLElement>(".fc-timegrid-slot-label-cushion").forEach((label) => {
        const lr = label.getBoundingClientRect();
        const overlaps = !!pillRect && lr.bottom > pillRect.top - 1 && lr.top < pillRect.bottom + 1;
        label.style.visibility = overlaps ? "hidden" : "";
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(grid);
    grid.addEventListener("scroll", schedule, true);
    const id = window.setInterval(schedule, 30_000);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      grid.removeEventListener("scroll", schedule, true);
      window.clearInterval(id);
      grid.querySelector(".cal-nowline")?.remove();
      // un-hide any hour label the now-pill had covered (see sync)
      grid
        .querySelectorAll<HTMLElement>(".fc-timegrid-slot-label-cushion")
        .forEach((label) => (label.style.visibility = ""));
    };
  }, [activeView]);

  // The weather card is mutually exclusive with the event context menu / editor —
  // opening one dismisses the weather card so two anchored layers never stack.
  // (openWxRef already clears the event surfaces when going the other way.)
  useEffect(() => {
    if (menu || sheet || scopePrompt) setWxPopover(null);
  }, [menu, sheet, scopePrompt]);

  // The reminder marker popover is mutually exclusive with the other anchored
  // layers the same way, and (being rect-anchored) must drop on navigation.
  useEffect(() => {
    if (menu || sheet || scopePrompt || wxPopover) setStopPopover(null);
  }, [menu, sheet, scopePrompt, wxPopover]);

  // Close the reminder popover once every reminder it pointed at is gone (e.g.
  // the last one deleted from inside it), so no empty card lingers.
  useEffect(() => {
    if (stopPopover && !stopPopover.ids.some((id) => events[id])) setStopPopover(null);
  }, [events, stopPopover]);

  // The Gather popover is mutually exclusive with the other anchored layers /
  // editor, and (rect-anchored) drops on navigation. It also self-closes once its
  // day no longer needs any kit (every contributing event removed / unlinked).
  useEffect(() => {
    if (menu || sheet || scopePrompt || wxPopover || stopPopover) setGatherPopover(null);
  }, [menu, sheet, scopePrompt, wxPopover, stopPopover]);
  useEffect(() => {
    if (gatherPopover && !(dayKitByDate.get(gatherPopover.date)?.items.length)) setGatherPopover(null);
  }, [dayKitByDate, gatherPopover]);

  // The Rain Review panel is mutually exclusive with the other anchored layers /
  // editor, and self-closes when its day's rain plan clears (a swap emptied it, or
  // the day was dismissed).
  useEffect(() => {
    if (menu || sheet || scopePrompt || wxPopover || stopPopover || gatherPopover) setRainPanel(null);
  }, [menu, sheet, scopePrompt, wxPopover, stopPopover, gatherPopover]);
  useEffect(() => {
    if (rainPanel && !rainPlanByDate.has(rainPanel.date)) setRainPanel(null);
  }, [rainPlanByDate, rainPanel]);

  // The day-shift card is mutually exclusive with the other anchored layers /
  // editor — opening any of them dismisses it (openShiftRef clears them going the
  // other way). It also drops on navigation via the same wx/menu closers upstream.
  useEffect(() => {
    if (menu || sheet || scopePrompt || wxPopover || stopPopover) setShiftBar(null);
  }, [menu, sheet, scopePrompt, wxPopover, stopPopover]);

  // The skip-days picker is likewise mutually exclusive with the editor / other
  // anchored surfaces (it opens FROM the menu, which closes on select).
  useEffect(() => {
    if (sheet || scopePrompt || shiftBar || stopPopover) setSkipPicker(null);
  }, [sheet, scopePrompt, shiftBar, stopPopover]);

  // "Hour" weather mode: paint a small chip (glyph + temp) into the top-right of
  // each hour block. The chips live INSIDE FullCalendar's own day columns
  // (.fc-timegrid-col-frame), positioned by a top percentage of the day window —
  // so they ride the horizontal scroll AND the vertical hour-zoom for free, with
  // no per-frame geometry sync (unlike the now-line). We only (re)build a column's
  // chips when its date or the forecast version changes; an unchanged column is
  // skipped, which keeps the MutationObserver from thrashing (a no-op sync writes
  // no DOM, so it can't re-trigger itself). FC may wipe the overlay when it
  // re-renders a column, so every pass re-asserts it (the now-line does the same).
  //   Clicks are caught in the CAPTURE phase on the grid and stopped there, so a
  // chip tap never reaches FC's date-click/drag-select underneath.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const active = weatherMode === "hour";
    const span = gridEnd - gridStart; // minutes across the drawn day

    const clearChips = () => grid.querySelectorAll(".cal-wx-col").forEach((n) => n.remove());

    const sync = () => {
      const data = weatherDataRef.current;
      if (!active || !data || span <= 0) {
        clearChips();
        return;
      }
      grid.querySelectorAll<HTMLElement>(".fc-timegrid-col[data-date]").forEach((col) => {
        const dateKey = col.getAttribute("data-date");
        const frame = col.querySelector<HTMLElement>(".fc-timegrid-col-frame");
        if (!dateKey || !frame) return;
        const key = dateKey + "|" + data.version;
        const existing = frame.querySelector<HTMLElement>(":scope > .cal-wx-col");
        if (existing && existing.dataset.wxKey === key) return; // already current
        existing?.remove();
        const overlay = document.createElement("div");
        overlay.className = "cal-wx-col";
        overlay.setAttribute("aria-hidden", "true");
        overlay.dataset.wxKey = key;
        for (let m = gridStart; m < gridEnd; m += 60) {
          const hour = m / 60;
          const w = data.hourly.get(dateKey + "@" + hour);
          if (!w) continue;
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "cal-wx-chip";
          chip.dataset.wxDate = dateKey;
          chip.dataset.wxHour = String(hour);
          chip.dataset.wxCond = w.condition;
          chip.style.top = ((m - gridStart) / span) * 100 + "%";
          chip.setAttribute(
            "aria-label",
            conditionLabel(w.condition, w.isDay) + " " + formatTemp(w.temp) + ". View detail"
          );
          chip.innerHTML =
            weatherGlyphSvg(w.condition, w.isDay) +
            '<span class="cal-wx-chip__temp">' +
            formatTemp(w.temp) +
            "</span>";
          overlay.appendChild(chip);
        }
        // Keep the keyed (possibly empty) overlay so out-of-forecast days aren't
        // rebuilt every pass — an empty overlay is inert (pointer-events: none).
        frame.appendChild(overlay);
      });
    };

    // A chip click/press is handled here and stopped before FC sees it.
    const onCapture = (e: Event) => {
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>(".cal-wx-chip") : null;
      if (!target) return;
      e.stopPropagation();
      if (e.type !== "click") return;
      const data = weatherDataRef.current;
      const dateKey = target.dataset.wxDate;
      const hour = Number(target.dataset.wxHour);
      const w = data && dateKey ? data.hourly.get(dateKey + "@" + hour) : undefined;
      if (w && dateKey) {
        openWxRef.current({ kind: "hour", date: dateKey, hour, weather: w }, target.getBoundingClientRect());
      }
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    schedule();
    grid.addEventListener("click", onCapture, true);
    grid.addEventListener("pointerdown", onCapture, true);
    grid.addEventListener("mousedown", onCapture, true);
    // FC re-renders columns on event/date changes; re-assert the chips after.
    const mo = new MutationObserver(schedule);
    mo.observe(grid, { childList: true, subtree: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(grid);

    return () => {
      cancelAnimationFrame(frame);
      grid.removeEventListener("click", onCapture, true);
      grid.removeEventListener("pointerdown", onCapture, true);
      grid.removeEventListener("mousedown", onCapture, true);
      mo.disconnect();
      ro.disconnect();
      clearChips();
    };
  }, [weatherMode, weatherData, gridStart, gridEnd, activeView]);

  // Stop markers: every reminder "stop" (the 0-min reminders sharing one exact
  // start time) is painted into FullCalendar's own day columns
  // (.fc-timegrid-col-frame), positioned by a top percentage of the day window —
  // the exact mechanism the weather hour chips use, so stops ride the horizontal
  // scroll AND the vertical hour-zoom for free and never enter FC's block-overlap
  // layout. A stop renders as a quiet hairline + count dot at the column's right
  // edge; real events stay native FC cards (never merged). A column is only
  // rebuilt when that day's stops change (keyed), so the MutationObserver can't
  // thrash. Clicks are caught in the CAPTURE phase and stopped before FC sees them.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const span = gridEnd - gridStart;

    const clearMarks = () => grid.querySelectorAll(".cal-stop-col").forEach((n) => n.remove());

    // Group the stops by day once per pass.
    const byDay = new Map<string, CalendarStop[]>();
    for (const stop of stops) {
      const list = byDay.get(stop.date);
      if (list) list.push(stop);
      else byDay.set(stop.date, [stop]);
    }

    const sync = () => {
      if (span <= 0) {
        clearMarks();
        return;
      }
      grid.querySelectorAll<HTMLElement>(".fc-timegrid-col[data-date]").forEach((col) => {
        const dateKey = col.getAttribute("data-date");
        const frame = col.querySelector<HTMLElement>(".fc-timegrid-col-frame");
        if (!dateKey || !frame) return;
        const dayStops = (byDay.get(dateKey) ?? []).slice().sort((a, b) => a.startMin - b.startMin);
        const existing = frame.querySelector<HTMLElement>(":scope > .cal-stop-col");
        // Delimiter-safe signature (JSON escapes the free-text title/note) that
        // also folds in the RESOLVED dot color, so a "Color by" switch or an
        // activity recolor reliably busts the keyed early-return below.
        const key = JSON.stringify(
          dayStops.map((s) => [
            s.startMin,
            s.events.map((e) => [e.id, e.title, e.note ?? "", stopDotColor(e)]),
          ])
        );
        if (existing && existing.dataset.stopKey === key) return; // already current
        existing?.remove();
        if (!dayStops.length) return; // nothing to draw — leave the column clean

        const overlay = document.createElement("div");
        overlay.className = "cal-stop-col";
        overlay.dataset.stopKey = key;
        for (const stop of dayStops) {
          if (stop.startMin < gridStart || stop.startMin > gridEnd) continue; // out of drawn window
          const count = stop.events.length;
          const titles = stop.events.map((e) => e.title || "Reminder").join(", ");
          const marker = document.createElement("button");
          marker.type = "button";
          marker.dataset.stopIds = stop.events.map((e) => e.id).join(",");
          marker.style.top = ((stop.startMin - gridStart) / span) * 100 + "%";

          // Reminder stop → a quiet hairline across the column with the count
          // dot anchored at the FAR RIGHT (in the lane events leave clear). A
          // lone reminder is a small plain dot; several show a number.
          marker.className = "cal-stop cal-stop--line";
          // The hairline + dot wear the reminder's OWN event color (same
          // coloring as any block), not a special reminder tint.
          marker.style.setProperty("--rem-tint", stopDotColor(stop.events[0]));
          marker.setAttribute(
            "aria-label",
            (count > 1 ? count + " reminders" : "Reminder") + " at " + formatClock(stop.startMin) + ": " + titles
          );
          marker.title = titles + " · " + formatClock(stop.startMin);
          const hair = document.createElement("span");
          hair.className = "cal-stop__hair";
          hair.setAttribute("aria-hidden", "true");
          const die = document.createElement("span");
          die.className = count > 1 ? "cal-stop__count" : "cal-stop__count cal-stop__count--solo";
          if (count > 1) die.textContent = String(count);
          marker.append(hair, die);
          overlay.appendChild(marker);
        }
        frame.appendChild(overlay);
      });
    };

    // A marker press/click is handled here and stopped before FC sees it. A lone
    // reminder's dot also starts a custom drag-to-move on pointerdown; if a drag
    // happened, its trailing click is swallowed so it doesn't also open the editor.
    const onCapture = (e: Event) => {
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>(".cal-stop") : null;
      if (!target) return;
      e.stopPropagation();
      if (e.type === "pointerdown") {
        remDraggedRef.current = false; // a fresh press; the drag re-sets this if it moves
        const ids = (target.dataset.stopIds ?? "").split(",").filter(Boolean);
        if (ids.length === 1) beginReminderDragRef.current(target, e as PointerEvent);
        return;
      }
      if (e.type !== "click") return;
      if (remDraggedRef.current) {
        remDraggedRef.current = false; // a drag just ended — swallow its click
        return;
      }
      const ids = (target.dataset.stopIds ?? "").split(",").filter(Boolean);
      if (ids.length) openStopRef.current(ids, target.getBoundingClientRect());
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    schedule();
    grid.addEventListener("click", onCapture, true);
    grid.addEventListener("pointerdown", onCapture, true);
    grid.addEventListener("mousedown", onCapture, true);
    const mo = new MutationObserver(schedule);
    mo.observe(grid, { childList: true, subtree: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(grid);

    return () => {
      cancelAnimationFrame(frame);
      grid.removeEventListener("click", onCapture, true);
      grid.removeEventListener("pointerdown", onCapture, true);
      grid.removeEventListener("mousedown", onCapture, true);
      mo.disconnect();
      ro.disconnect();
      clearMarks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, gridStart, gridEnd, activeView, stopDotColor]);

  // "Day" weather adds a glyph + high/low under each column's date, growing the
  // header. The all-day row pins below the header via --cal-headh (set in
  // recomputeDayWidth), so re-measure whenever day weather appears, updates, or
  // clears — otherwise the all-day lane would sit at a stale offset.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => recomputeDayWidth());
    return () => window.cancelAnimationFrame(id);
  }, [weatherMode, weatherData, recomputeDayWidth]);

  // Keyboard shortcuts, matching Notion Calendar: t today; d/1 Day, w/0 Week,
  // m Month, 2–9 an N-day window; j/→ next, k/← previous (slide-and-snap).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // Delete / Backspace deletes the current selection (a plain click leaves a
      // 1-item selection beneath the editor), suppressed while an editor sheet, an
      // open bulk picker, or the scope prompt is up:
      //   · a single selected event → the per-event delete, so a recurring one
      //     still routes through the this/following/all scope dialog;
      //   · a multi-selection → delete them ALL in one undoable step.
      if ((event.key === "Backspace" || event.key === "Delete") && !sheet && !scopePrompt && !bulkPicker) {
        if (selection.size === 1) {
          const only = events[[...selection][0]];
          if (only) {
            event.preventDefault();
            deleteEvent(only);
            return;
          }
        }
        if (selection.size) {
          event.preventDefault();
          deleteSelection();
          return;
        }
      }
      // Undo / redo: Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, scoped to the calendar.
      // Handled BEFORE the modifier early-return below. Suppressed while an
      // editing surface is open so the sheet's own fields keep native undo (and
      // a stray Cmd+Z doesn't rewrite the calendar out from under an open editor).
      if ((event.metaKey || event.ctrlKey) && (event.key === "z" || event.key === "Z")) {
        if (sheet || settingsOpen || scopePrompt) return;
        event.preventDefault();
        if (event.shiftKey) {
          if (redo()) announce("Redid the last change");
        } else if (undo()) {
          announce("Undid the last change");
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (sheet || settingsOpen || scopePrompt) return;
      const api = calendarRef.current?.getApi();
      if (!api) return;
      switch (event.key) {
        case "t":
          goToday();
          break;
        case "d":
        case "1":
          changeView("timeGridDay");
          break;
        case "w":
        case "0":
          changeView("timeGridWeek");
          break;
        case "m":
          changeView("dayGridMonth");
          break;
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9":
          changeView({ type: "ndays", n: Number(event.key) });
          break;
        case "ArrowLeft":
        case "k":
          nudge(-1);
          break;
        case "ArrowRight":
        case "j":
          nudge(1);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeView, goToday, nudge, deleteEvent, deleteSelection, selection, events, bulkPicker, undo, redo, announce, sheet, settingsOpen, scopePrompt]);

  // Escape clears the multi-selection. We honour the app's capture-phase Escape
  // contract (see FloatingLayer/useDialogFocus): a capture listener that runs
  // FIRST but BAILS on defaultPrevented, then preventDefault()s itself so any
  // bubble-phase dialog underneath stays untouched. Only armed when there's a
  // real selection AND nothing is open over it — a menu/sheet/scope prompt/bulk
  // picker owns its own Escape (close the layer first), and a plain click leaves
  // a 1-item selection beneath the editor this must NOT swallow.
  useEffect(() => {
    if (!selection.size || menu || sheet || scopePrompt || settingsOpen || bulkPicker) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      // A dialog opened OUTSIDE this shell's own local state (e.g. the run-sheet
      // modal opened from an event, tracked in CampApp) can leave a stray 1-item
      // selection alive underneath it. Without this bail this capture-phase
      // listener still fires first and eats the Escape meant for that dialog's
      // useDialogFocus stack.
      if (hasOpenDialog()) return;
      event.preventDefault();
      clearSelection();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [selection, menu, sheet, scopePrompt, settingsOpen, bulkPicker, clearSelection]);

  const isMonthView = activeView === "dayGridMonth";

  // Memoize the FullCalendar element so the heavy grid only re-renders when a
  // prop that genuinely affects it changes (events, grid hours, weekends, Month
  // vs strip). Crucially it does NOT re-render on the scroll-driven title /
  // visible-window state, nor on a Day↔Week↔N zoom (that's pure CSS day width) —
  // which is what keeps the continuous scroll smooth and avoids FullCalendar's
  // height:auto flushSync churn on every frame.
  const calendarEl = useMemo(
    () =>
      resolvedView ? (
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={fcType(resolvedView)}
          initialDate={
            fcType(resolvedView) === "timeGridStrip" && stripStartRef.current
              ? fromDateKey(stripStartRef.current)
              : undefined
          }
          views={CALENDAR_VIEWS}
          // Weekends always show: the strip is a continuous run of days, and
          // Month reads better whole than with Sat/Sun clipped out.
          weekends={true}
          headerToolbar={false}
          // Only Month's columns honour the week-start pref; the strip is
          // day-aligned (firstDay inert) and is kept on a fixed value so a
          // weekStart change never disturbs its scroll position.
          firstDay={isMonthView ? weekStart : STRIP_FIRST_DAY}
          // Strip renders at natural height inside the single native 2-axis
          // scroller (.calshell__grid--strip); Month fills its own box.
          height={isMonthView ? "100%" : "auto"}
          nowIndicator
          editable={canEdit}
          selectable={canEdit}
          selectMinDistance={8}
          unselectAuto={false}
          droppable={canEdit}
          dayMaxEvents={3}
          slotEventOverlap={false}
          eventMaxStack={4}
          eventShortHeight={46}
          eventMinHeight={0}
          snapDuration={snapDurationStr}
          slotDuration="00:15:00"
          slotLabelInterval="01:00:00"
          slotMinTime={minutesToTimeString(gridStart)}
          slotMaxTime={minutesToTimeString(gridEnd)}
          eventTimeFormat={{ hour: "numeric", minute: "2-digit", omitZeroMinute: true, meridiem: "narrow" }}
          scrollTime={scrollTime}
          scrollTimeReset={false}
          longPressDelay={400}
          eventLongPressDelay={400}
          selectLongPressDelay={500}
          allDayText="all day"
          datesSet={onDatesSet}
          select={onSelect}
          dateClick={onDateClick}
          eventClick={onEventClick}
          eventDragStart={startMoveAffordance}
          eventDragStop={stopDragAffordance}
          eventResizeStart={startResizeAffordance}
          eventResizeStop={stopDragAffordance}
          eventDrop={onEventDrop}
          eventResize={onEventResize}
          eventReceive={onEventReceive}
          eventDidMount={onEventDidMount}
          eventContent={renderEventContent}
          dayHeaderContent={renderDayHeader}
          events={fcEvents}
        />
      ) : null,
    // stripStart is intentionally omitted: initialDate only applies at mount, and
    // re-anchors move the view via the imperative gotoDate in the stripStart
    // effect — a stripStart dep would force a redundant FullCalendar re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      resolvedView,
      isMonthView,
      weekStart,
      canEdit,
      gridStart,
      gridEnd,
      snapDurationStr,
      scrollTime,
      fcEvents,
      onDatesSet,
      onSelect,
      onDateClick,
      onEventClick,
      startMoveAffordance,
      stopDragAffordance,
      startResizeAffordance,
      onEventResize,
      onEventDrop,
      onEventReceive,
      onEventDidMount,
      renderEventContent,
      renderDayHeader,
    ]
  );

  return (
    <div className="calshell">
      <CalendarHeader
        title={title}
        view={activeView}
        todayInView={todayInView}
        onView={changeView}
        onToday={goToday}
        onOpenSettings={() => setSettingsOpen(true)}
        onAdd={openAddSheet}
        colorLens={
          colorMode === "custom"
            ? undefined
            : colorMode === "type"
              ? "Type"
              : colorMode === "rating"
                ? "Rating"
                : colorMode === "location"
                  ? "Location"
                  : "Theme"
        }
      />
      <div className="calshell__body">
        <div
          ref={gridRef}
          className={
            "calshell__grid" +
            (isMonthView ? "" : " calshell__grid--strip") +
            (shadeWeekends ? " is-shade-weekends" : "")
          }
          onScroll={isMonthView ? undefined : onGridScroll}
          onContextMenu={onGridContextMenu}
        >
          {calendarEl}
          {/* The free-following "card in hand" during a drag: a full-opacity
              clone of the event that tracks the raw cursor (the snapped dotted
              box is FullCalendar's own mirror). Positioned in JS by
              traceFollower; aria-hidden — purely a visual drag preview. */}
          <div ref={followRef} className="cal-dragfollow fc-event" aria-hidden="true" />
        </div>
        {/* The sidebar (a slot CampApp owns) carries the calendar's left rail:
            the mini-month overview on top, the collapsible View settings below.
            Both stay children of CalendarShell so the calendar API and view range
            are in reach. Null slot (mobile) → the header Add / FAB take over;
            events are composed through QuickAdd (its Library tab picks an
            activity), so the rail no longer needs a drag source. */}
        {railSlot &&
          createPortal(
            <CalendarRail
              month={{
                anchorDate: miniAnchor,
                viewStart: visibleRange?.start ?? null,
                viewEnd: visibleRange?.end ?? null,
                today: todayKey(),
                todayInView,
                eventDays,
                firstDay: weekStart,
                onPick: gotoMiniDate,
                onToday: goToday,
              }}
              view={{
                view: activeView,
                colorMode,
                onColorMode: setColorMode,
                shadeWeekendsOn: shadeWeekends,
                onToggleShadeWeekends: () => setShadeWeekends((on) => !on),
                weekStart,
                onWeekStart: setWeekStart,
                onChangeView: changeView,
                onOpenCamps,
                subscribeControl,
              }}
              weather={{
                weatherMode,
                onWeatherMode: setWeatherMode,
                weatherUnit,
                onWeatherUnit: setWeatherUnit,
                weatherLocation,
                onWeatherLocation: setWeatherLocation,
                weatherRange,
                onWeatherRange: setWeatherRange,
                weatherHistory,
                onWeatherHistory: setWeatherHistory,
                rainThreshold,
                onRainThreshold: (v) => setRainThreshold(parseRainThreshold(v, rainThreshold)),
                rainThresholdOptions: RAIN_THRESHOLD_OPTIONS,
                weatherStatus,
                weatherCoverage,
              }}
            />,
            railSlot
          )}
      </div>

      <button
        type="button"
        className="calshell__fab"
        onClick={openAddSheet}
        aria-label="Add to calendar"
        title="Add to calendar"
      >
        <CampIcon.Plus />
      </button>

      {sheet && (
        <QuickAdd
          // quickadd-11: QuickAdd's local state (query/date/recurrence/
          // etc.) is seeded ONLY via useState initializers from `draft` at mount,
          // with no reset-on-prop-change effect. Without a key, if `sheet` were
          // ever replaced from one non-null draft straight to a different
          // non-null draft (no intervening null), React would reuse the mounted
          // instance and keep the STALE draft's state. Every current call site
          // happens to route through a null transition first, so this "worked",
          // but nothing in QuickAdd itself guarded against it. Keying the mount
          // on the draft's identity (its id, or "new" while creating) forces a
          // clean remount — and a fresh useState seed — on every distinct sheet,
          // the idiomatic React reset-on-remount fix, simpler than adding a
          // parallel reset-effect that would have to shadow every field.
          key={sheet.draft.id ?? "new"}
          draft={sheet.draft}
          pickTime={sheet.pickTime}
          activities={activities}
          kitStock={kitStock}
          materialCatalog={materialCatalog}
          dayEvents={healedEvents}
          byId={byId}
          window={window_}
          snap={snap}
          locationOptions={locationOptions}
          onManageLocations={onManageLocations}
          onPickActivity={quickAddActivity}
          onCreateActivity={onCreateActivity}
          onSave={saveDraft}
          onDelete={
            sheet.draft.id
              ? () => {
                  const existing = events[sheet.draft.id as string];
                  if (existing) deleteEvent(existing);
                }
              : undefined
          }
          // quickadd-2: Delete on a series member only skips THIS day (instant,
          // with a toast escalation) — a staffer who opened the sheet SPECIFICALLY
          // to delete the whole series had no way to do that without closing the
          // sheet and right-clicking. This mirrors the context menu's "Delete
          // entire series…" safety hatch exactly (same scopePrompt, same dialog),
          // just reachable from the touch/edit surface too. Only rendered for an
          // existing series member.
          onDeleteSeries={
            sheet.draft.id && events[sheet.draft.id]?.seriesId
              ? () => {
                  const existing = events[sheet.draft.id as string];
                  if (!existing) return;
                  if (!requireStaff("change the calendar")) return;
                  setSheet(null);
                  setScopePrompt({ mode: "delete", event: existing });
                }
              : undefined
          }
          onDuplicate={
            sheet.draft.id
              ? () => {
                  const existing = events[sheet.draft.id as string];
                  if (existing) duplicateEvent(existing);
                  setSheet(null);
                }
              : undefined
          }
          onOpenActivity={
            sheet.draft.id && sheet.draft.activityId && byId[sheet.draft.activityId]
              ? () => {
                  const activity = byId[sheet.draft.activityId as string];
                  const existing = events[sheet.draft.id as string];
                  setSheet(null);
                  if (activity && existing) onOpenActivity(activity, existing);
                }
              : undefined
          }
          onTogglePin={
            sheet.draft.id
              ? () => {
                  const existing = events[sheet.draft.id as string];
                  // Immediate + series-wide; the sheet stays open (togglePin never
                  // closes it), so the pin flips under the editor.
                  if (existing) togglePin(healEvent(existing, byId));
                }
              : undefined
          }
          onApplyAll={
            sheet.draft.id && events[sheet.draft.id]?.seriesId && events[sheet.draft.id]?.custom?.length
              ? () => {
                  const existing = events[sheet.draft.id as string];
                  if (existing) applyRowScope(healEvent(existing, byId), "all");
                }
              : undefined
          }
          onApplyFollowing={
            sheet.draft.id && events[sheet.draft.id]?.seriesId && events[sheet.draft.id]?.custom?.length
              ? () => {
                  const existing = events[sheet.draft.id as string];
                  if (existing) applyRowScope(healEvent(existing, byId), "following");
                }
              : undefined
          }
          onResetOccurrence={
            sheet.draft.id && events[sheet.draft.id]?.seriesId && events[sheet.draft.id]?.custom?.length
              ? () => {
                  const existing = events[sheet.draft.id as string];
                  if (existing) resetOccurrence(healEvent(existing, byId));
                }
              : undefined
          }
          onRestoreSkip={
            sheet.draft.id && events[sheet.draft.id]?.seriesId
              ? (date) => {
                  const existing = events[sheet.draft.id as string];
                  if (existing?.seriesId) {
                    setSheet(null);
                    restoreOccurrence(existing.seriesId, date);
                  }
                }
              : undefined
          }
          pinned={Boolean(sheet.draft.id && events[sheet.draft.id]?.pinned)}
          onRecoverTime={
            sheet.draft.id
              ? (extend) => {
                  const existing = events[sheet.draft.id as string];
                  if (!existing) return;
                  setSheet(null);
                  openShiftRef.current({
                    date: existing.date,
                    cutoffMin: extend ? existing.endMin : existing.startMin,
                    extendEventId: extend ? existing.id : undefined,
                    // No cursor point from a sheet button — dock/center via a
                    // synthetic rect at the viewport middle (rect anchor flips as
                    // needed; on coarse pointers it bottom-docks regardless).
                    anchor: {
                      kind: "rect",
                      rect:
                        typeof window !== "undefined"
                          ? new DOMRect(window.innerWidth / 2 - 150, window.innerHeight / 2 - 40, 300, 0)
                          : new DOMRect(0, 0, 300, 0),
                    },
                  });
                }
              : undefined
          }
          backupAlternates={
            sheet.draft.id && events[sheet.draft.id]
              ? resolveAlternates(
                  healEvent(events[sheet.draft.id], byId),
                  events[sheet.draft.id].activityId ? byId[events[sheet.draft.id].activityId as string] : undefined
                )
              : []
          }
          hasOwnBackups={Boolean(sheet.draft.id && events[sheet.draft.id]?.alternates !== undefined)}
          onSwapBackup={
            sheet.draft.id
              ? (index) => {
                  const existing = events[sheet.draft.id as string];
                  if (!existing) return;
                  setSheet(null);
                  promoteBackup(healEvent(existing, byId), index);
                }
              : undefined
          }
          onEditBackups={
            sheet.draft.id
              ? () => {
                  const existing = events[sheet.draft.id as string];
                  if (!existing) return;
                  const healed = healEvent(existing, byId);
                  // Copy-on-write: seed the placement's own list from the resolved
                  // one so it can diverge from the activity default. A no-op when it
                  // already carries its own list.
                  if (healed.alternates !== undefined) return;
                  const resolved = resolveAlternates(
                    healed,
                    healed.activityId ? byId[healed.activityId] : undefined
                  );
                  setEventAlternates(healed, resolved.map((a) => ({ ...a })));
                }
              : undefined
          }
          onClearBackups={
            sheet.draft.id
              ? () => {
                  const existing = events[sheet.draft.id as string];
                  if (existing) setEventAlternates(healEvent(existing, byId), []);
                }
              : undefined
          }
          onClose={() => setSheet(null)}
        />
      )}

      {/* Mobile's home for the settings (desktop puts them in the sidebar). The
          sheet is the disclosure, so View and Weather show as two labelled groups
          (mirroring the desk rail's two toggles) — opening Manage camps dismisses
          this sheet first so the next modal isn't stacked behind. */}
      {settingsOpen && (
        <Modal
          label="Calendar settings"
          onClose={() => setSettingsOpen(false)}
          overlayProps={{ className: "overlay--card" }}
        >
          <div className="overlay__bar">
            <h2 className="filtersheet__title">Settings</h2>
          </div>
          <div className="overlay__body filtersheet">
            <h3 className="calset__sheettitle">View</h3>
            <CalendarViewSettings
              view={activeView}
              colorMode={colorMode}
              onColorMode={setColorMode}
              shadeWeekendsOn={shadeWeekends}
              onToggleShadeWeekends={() => setShadeWeekends((on) => !on)}
              weekStart={weekStart}
              onWeekStart={setWeekStart}
              onChangeView={changeView}
              onOpenCamps={() => {
                setSettingsOpen(false);
                onOpenCamps();
              }}
              subscribeControl={subscribeControl}
            />
            <h3 className="calset__sheettitle">Weather</h3>
            <WeatherSettings
              weatherMode={weatherMode}
              onWeatherMode={setWeatherMode}
              weatherUnit={weatherUnit}
              onWeatherUnit={setWeatherUnit}
              weatherLocation={weatherLocation}
              onWeatherLocation={setWeatherLocation}
              weatherRange={weatherRange}
              onWeatherRange={setWeatherRange}
              weatherHistory={weatherHistory}
              onWeatherHistory={setWeatherHistory}
              rainThreshold={rainThreshold}
              onRainThreshold={(v) => setRainThreshold(parseRainThreshold(v, rainThreshold))}
              rainThresholdOptions={RAIN_THRESHOLD_OPTIONS}
              weatherStatus={weatherStatus}
              weatherCoverage={weatherCoverage}
            />
          </div>
        </Modal>
      )}

      {wxPopover && weatherData && (
        <WeatherPopover
          target={wxPopover.target}
          units={weatherData.units}
          locationName={weatherData.location.name}
          anchor={wxPopover.anchor}
          onClose={() => setWxPopover(null)}
        />
      )}

      {stopPopover &&
        (() => {
          // Resolve the live event rows for the clicked stop; if they've all since
          // been removed, render nothing (the effect below closes it).
          const list = stopPopover.ids.map((id) => events[id]).filter(Boolean) as CalendarEvent[];
          if (!list.length) return null;
          return (
            <StopPopover
              events={list}
              colorOf={stopDotColor}
              anchor={stopPopover.anchor}
              onEdit={openStopEdit}
              onDelete={(event) => deleteEvent(event)}
              onAddAtTime={() => openAddAtStop(list[0].date, list[0].startMin)}
              onClose={() => setStopPopover(null)}
            />
          );
        })()}

      {/* The Gather popover — the day's kit gather list + any hard conflicts
          pinned on top. Rows are resolved LIVE from dayKitByDate so a stock/plenty
          edit re-renders it in place; if the day empties of kit it self-closes. */}
      {gatherPopover &&
        (() => {
          const day = dayKitByDate.get(gatherPopover.date);
          if (!day || !day.items.length) return null;
          return (
            <GatherPopover
              date={gatherPopover.date}
              day={day}
              anchor={gatherPopover.anchor}
              stock={kitStock}
              catalog={materialCatalog}
              events={events}
              canEdit={Boolean(setStockState)}
              onSetStock={setStockState}
              onMarkPlenty={markPlenty}
              onClose={() => setGatherPopover(null)}
            />
          );
        })()}

      {/* The Rain Review panel — the day's at-risk outdoor blocks + their backups.
          Rows resolve live from rainPlanByDate so a promote (or a threshold change)
          re-renders it in place; it self-closes when the day's plan clears. */}
      {rainPanel &&
        (() => {
          const plan = rainPlanByDate.get(rainPanel.date);
          if (!plan) return null;
          return (
            <RainPanel
              date={rainPanel.date}
              plan={plan}
              anchor={rainPanel.anchor}
              byId={byId}
              activities={activities}
              events={events}
              stock={kitStock}
              catalog={materialCatalog}
              onPromote={promoteBackup}
              onPickBackup={(event, alt) => setEventAlternates(event, [alt])}
              onSwitchAll={() => promoteAllForDay(rainPanel.date)}
              onShiftDay={(rect) =>
                openShiftRef.current({
                  date: rainPanel.date,
                  cutoffMin: 0,
                  anchor: { kind: "rect", rect },
                })
              }
              onDismiss={() => dismissRainDay(rainPanel.date)}
              onClose={() => setRainPanel(null)}
            />
          );
        })()}

      {/* The day-shift card. In-app the events are already camp-filtered, so the
          bar runs planDayShift WITHOUT a campId; closeMin is the camp day window's
          end (a soft close the planner flags a spill past). */}
      {shiftBar &&
        (() => {
          const dayEvents = healedEvents.filter((event) => event.date === shiftBar.date);
          return (
            <ShiftBar
              target={shiftBar}
              dayEvents={dayEvents}
              closeMin={window_.endMin}
              snapMin={snap}
              isToday={shiftBar.date === todayKey()}
              colorOf={stopDotColor}
              onCommit={commitDayShift}
              onClose={() => setShiftBar(null)}
            />
          );
        })()}

      {/* Single-event context menu. Gains the day-shift doors ("Running long…" /
          "Shift day from here…") and the scope-free series-wide "Pin in place". */}
      {menu?.kind === "single" &&
        (() => {
          const ev = menu.event;
          const point = menu.point;
          const isTimed = !ev.allDay;
          const isReminder = isTimed && ev.endMin === ev.startMin; // 0-min
          // The one axis the menu keys off: is this placement ATTACHED to a
          // library activity, or an ISOLATED one-off? Attached → open its Run
          // List; isolated (with a title) → offer to save it into the library.
          // Everything below the identity item is common to both.
          const isLibraryLinked = !!(ev.activityId && byId[ev.activityId]);
          const hasIdentityItem = isLibraryLinked || !!ev.title;
          return (
            <ContextMenu
              point={point}
              ariaLabel={ev.title || "Event"}
              onClose={() => setMenu(null)}
              items={[
                // ── Library identity — the one contextual header of the menu.
                ...(isLibraryLinked
                  ? [
                      {
                        label: "Open Run List",
                        icon: <CampIcon.BookOpen />,
                        onSelect: () => {
                          const activity = byId[ev.activityId as string];
                          if (activity) onOpenActivity(activity, ev);
                        },
                      },
                    ]
                  : ev.title
                    ? [
                        {
                          label: "Save to library",
                          icon: <CampIcon.Bookmark />,
                          onSelect: () => {
                            setMenu(null);
                            saveToLibrary(ev);
                          },
                        },
                      ]
                    : []),
                {
                  label: "Edit",
                  icon: <CampIcon.Pencil />,
                  // Sits under the library header when there is one, so the
                  // identity action reads apart from the property edits.
                  separatorBefore: hasIdentityItem,
                  onSelect: () => {
                    if (!requireStaff("change the calendar")) return;
                    setSheet({ draft: draftFromEvent(ev), pickTime: true });
                  },
                },
                // camps-2/J2: only offered when a camp IS active and this event
                // is one of the "shared" ones (no campId of its own) — claiming
                // moves it out of every-camp visibility into just this one.
                ...(activeCamp && !ev.campId
                  ? [
                      {
                        label: "Claim into " + activeCamp.name,
                        icon: <CampIcon.Home />,
                        onSelect: () => {
                          setMenu(null);
                          claimIntoActiveCamp([ev.id]);
                        },
                      },
                    ]
                  : []),
                {
                  // The right-click way into recurrence: opens the editor where the
                  // Repeat control lives (reads "Edit repeat…" once a rule is set).
                  label: ev.recurrence ? "Edit repeat…" : "Repeat…",
                  icon: <CampIcon.Repeat />,
                  onSelect: () => {
                    if (!requireStaff("change the calendar")) return;
                    setSheet({ draft: draftFromEvent(ev), pickTime: true });
                  },
                },
                {
                  // Inline color for ONE event — the audit's "recoloring means
                  // opening the editor" gap. Reuses the bulk picker body with a
                  // single-id set, so both entry points share one write path.
                  label: "Color…",
                  icon: <CampIcon.Palette />,
                  onSelect: () => {
                    if (!requireStaff("change the calendar")) return;
                    setBulkPicker({ kind: "color", ids: [ev.id], point });
                  },
                },
                {
                  // Pin / unpin — SERIES-WIDE and scope-free (a partially-pinned
                  // series is unrepresentable). Commits instantly, no dialog.
                  label: ev.pinned ? "Unpin" : "Pin in place",
                  icon: <PinInPlaceIcon />,
                  onSelect: () => togglePin(ev),
                },
                {
                  label: "Duplicate",
                  icon: <CampIcon.Copy />,
                  onSelect: () => duplicateEvent(ev),
                },
                // Swap to a backup plan — opens the resolved-alternates picker at
                // the cursor (a secondary FloatingLayer; ContextMenu has no nested
                // submenu). Only shown when this placement resolves to any backup.
                ...(resolveAlternates(ev, ev.activityId ? byId[ev.activityId] : undefined).length
                  ? [
                      {
                        label: "Swap to backup",
                        icon: <BackupUmbrellaGlyph />,
                        onSelect: () => {
                          if (!requireStaff("change the calendar")) return;
                          setMenu(null);
                          setSwapPicker({ eventId: ev.id, point });
                        },
                      },
                    ]
                  : []),
                // Split days — "Add second run today" clones this event's identity
                // onto the next free slot of the same day, sharing a fresh linkId so
                // the two read as legs of one unit (rule 8). Timed events only.
                ...(isTimed
                  ? [
                      {
                        label: "Add second run today",
                        icon: <CampIcon.Copy />,
                        onSelect: () => addSecondRun(ev),
                      },
                    ]
                  : []),
                // Durable recurrence escalation + reset + skip-days — only on a
                // series member. "Apply to all / from here on" and "Reset to series"
                // act on a THIS-customized row (custom?.length); "Skip days…" and
                // "Delete entire series…" always show for a member.
                ...(ev.seriesId
                  ? [
                      {
                        label: "Apply to all occurrences",
                        icon: <CampIcon.Repeat />,
                        separatorBefore: true,
                        disabled: !ev.custom?.length,
                        onSelect: () => applyRowScope(ev, "all"),
                      },
                      {
                        label: "Apply from here on",
                        icon: <CampIcon.Repeat />,
                        disabled: !ev.custom?.length,
                        onSelect: () => applyRowScope(ev, "following"),
                      },
                      {
                        label: "Reset to series",
                        icon: <CampIcon.Reset />,
                        disabled: !ev.custom?.length,
                        onSelect: () => resetOccurrence(ev),
                      },
                      {
                        label: "Skip days…",
                        icon: <CampIcon.Calendar />,
                        onSelect: () =>
                          setSkipPicker({ seriesId: ev.seriesId as string, point }),
                      },
                    ]
                  : []),
                // Day-shift doors, only for TIMED events. "Running long…" (extend
                // this event's end + slide the rest) is hidden for a 0-min reminder;
                // "Shift day from here…" (slide everything from this start) applies
                // to any timed event including a reminder.
                ...(isTimed && !isReminder
                  ? [
                      {
                        label: "Running long…",
                        icon: <CampIcon.Clock />,
                        separatorBefore: true,
                        onSelect: () =>
                          openShiftRef.current({
                            date: ev.date,
                            cutoffMin: ev.endMin,
                            extendEventId: ev.id,
                            anchor: { kind: "point", x: point.x, y: point.y },
                          }),
                      },
                    ]
                  : []),
                ...(isTimed
                  ? [
                      {
                        label: "Shift day from here…",
                        icon: <CampIcon.Clock />,
                        separatorBefore: isReminder,
                        onSelect: () =>
                          openShiftRef.current({
                            date: ev.date,
                            cutoffMin: ev.startMin,
                            anchor: { kind: "point", x: point.x, y: point.y },
                          }),
                      },
                    ]
                  : []),
                {
                  label: ev.seriesId ? "Skip this day" : "Delete",
                  icon: <CampIcon.Trash />,
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => deleteEvent(ev),
                },
                // The deliberate safety hatch — the ONLY surviving use of the
                // this/following/all scope dialog (delete-mode, following/all only).
                ...(ev.seriesId
                  ? [
                      {
                        label: "Delete entire series…",
                        icon: <CampIcon.Trash />,
                        danger: true,
                        onSelect: () => {
                          if (!requireStaff("change the calendar")) return;
                          setMenu(null);
                          setScopePrompt({ mode: "delete", event: ev });
                        },
                      },
                    ]
                  : []),
              ]}
            />
          );
        })()}

      {/* Empty-slot right-click → one item that opens the day-shift card at the
          clicked date + minute (timed columns only; see onGridContextMenu). */}
      {menu?.kind === "shift" &&
        (() => {
          const { date, cutoffMin, point } = menu;
          return (
            <ContextMenu
              point={point}
              ariaLabel="Recover time"
              onClose={() => setMenu(null)}
              items={[
                {
                  label: "Shift day from " + formatClock(cutoffMin) + "…",
                  icon: <CampIcon.Clock />,
                  onSelect: () =>
                    openShiftRef.current({
                      date,
                      cutoffMin,
                      anchor: { kind: "point", x: point.x, y: point.y },
                    }),
                },
              ]}
            />
          );
        })()}

      {/* Bulk context menu — the SAME ContextMenu/style as the single-event one,
          opened (by onGridContextMenu) when the right-clicked event is part of a
          multi-selection. Move-by-drag now handles shifting the group, so this
          carries only the cross-cutting property edits + duplicate/delete. Color…
          and Location… open their pickers cursor-anchored at the menu point (the
          app's floating-picker pattern); All day / Timed and the rest apply
          directly. Staffing is enforced by the underlying mutations. */}
      {menu?.kind === "bulk" &&
        (() => {
          const ids = menu.ids;
          const point = menu.point;
          const count = ids.length;
          const noun = count === 1 ? "event" : "events";
          // If EVERY selected event is already all-day, the toggle offers "Timed";
          // otherwise it offers "All day" (so a mixed set lands all-day first).
          const allAreAllDay = ids.every((id) => events[id]?.allDay);
          // camps-2/J2: how many of the selected events are "shared" (no campId
          // of their own) — the claim action only ever touches those, and is
          // hidden entirely when none of the selection qualifies.
          const claimableCount = activeCamp
            ? ids.filter((id) => events[id] && !events[id].campId).length
            : 0;
          return (
            <ContextMenu
              point={point}
              ariaLabel={count + " selected " + noun}
              onClose={() => setMenu(null)}
              items={[
                ...(activeCamp && claimableCount > 0
                  ? [
                      {
                        label:
                          "Claim " +
                          claimableCount +
                          " " +
                          (claimableCount === 1 ? "event" : "events") +
                          " into " +
                          activeCamp.name,
                        icon: <CampIcon.Home />,
                        onSelect: () => {
                          setMenu(null);
                          claimIntoActiveCamp(ids);
                        },
                      },
                    ]
                  : []),
                {
                  label: "Color…",
                  icon: <CampIcon.Palette />,
                  onSelect: () => {
                    if (!requireStaff("change the calendar")) return;
                    setBulkPicker({ kind: "color", ids, point });
                  },
                },
                {
                  label: "Location…",
                  icon: <CampIcon.Pin />,
                  onSelect: () => {
                    if (!requireStaff("change the calendar")) return;
                    setBulkPicker({ kind: "location", ids, point });
                  },
                },
                {
                  label: allAreAllDay ? "Make timed" : "Make all day",
                  icon: <CampIcon.Clock />,
                  onSelect: () => setSelectionAllDay(ids, !allAreAllDay),
                },
                {
                  label: "Duplicate " + count + " " + noun,
                  icon: <CampIcon.Copy />,
                  onSelect: () => duplicateSelection(ids),
                },
                {
                  label: "Delete " + count + " " + noun,
                  icon: <CampIcon.Trash />,
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => deleteSelection(),
                },
              ]}
            />
          );
        })()}

      {/* Cursor-anchored bulk pickers, opened from the bulk menu. Both reuse the
          exact picker bodies the QuickAdd fields use (one picker, two entry
          points), hosted directly in a FloatingLayer at the menu point. Each pick
          applies across the selection as one undoable commit via applyBulkEdit
          (which re-asserts the moved set as the live selection). */}
      {bulkPicker?.kind === "color" && (
        <FloatingLayer
          anchor={{ kind: "point", x: bulkPicker.point.x, y: bulkPicker.point.y }}
          onClose={() => setBulkPicker(null)}
          className="ccolor__pop"
          role="dialog"
          ariaLabel="Color for selected events"
        >
          <ColorPickerBody
            // A single-event pick shows the event's current color as selected;
            // a heterogeneous bulk set has no one "current", so nothing preselects.
            value={bulkPicker.ids.length === 1 ? events[bulkPicker.ids[0]]?.color : undefined}
            fallback={categoryTint(undefined)}
            onCommit={(hex) => {
              applyBulkEdit(bulkPicker.ids, { color: hex });
              setBulkPicker(null);
            }}
            onReset={() => {
              applyBulkEdit(bulkPicker.ids, { color: undefined });
              setBulkPicker(null);
            }}
          />
        </FloatingLayer>
      )}
      {bulkPicker?.kind === "location" && (
        <FloatingLayer
          anchor={{ kind: "point", x: bulkPicker.point.x, y: bulkPicker.point.y }}
          onClose={() => setBulkPicker(null)}
          className="typepick__menu cselect__menu"
          role="listbox"
          ariaLabel="Location for selected events"
          initialFocus={false}
        >
          {/* A bulk location set is a REPLACE across the selection: the picker
              owns its own working set (so the toggled rows stay checked while the
              menu is open) and re-applies it to every selected event on each
              toggle, all as one undoable commit. */}
          <BulkLocationPicker
            options={locationOptions}
            onApply={(locations) => applyBulkEdit(bulkPicker.ids, { locations })}
            onManage={() => {
              setBulkPicker(null);
              onManageLocations();
            }}
          />
        </FloatingLayer>
      )}
      {/* "Swap to backup ▸" — the placement's resolved alternates as a picker.
          Re-derives the live event + list at render so a concurrent edit can't act
          on a stale row; tapping a row runs the self-inverse promoteBackup. */}
      {swapPicker &&
        (() => {
          const live = events[swapPicker.eventId];
          if (!live) return null;
          const ev = healEvent(live, byId);
          const resolved = resolveAlternates(ev, ev.activityId ? byId[ev.activityId] : undefined);
          if (!resolved.length) return null;
          return (
            <FloatingLayer
              anchor={{ kind: "point", x: swapPicker.point.x, y: swapPicker.point.y }}
              onClose={() => setSwapPicker(null)}
              className="typepick__menu cselect__menu cal-swappick"
              role="listbox"
              ariaLabel="Swap to backup plan"
            >
              {resolved.map((alt, index) => (
                <button
                  type="button"
                  key={index}
                  className="cselect__option"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    promoteBackup(ev, index);
                    setSwapPicker(null);
                  }}
                >
                  {alt.reason === "rain" ? (
                    <BackupUmbrellaGlyph className="cal-swappick__glyph" />
                  ) : (
                    <CampIcon.Repeat className="cal-swappick__glyph" />
                  )}
                  <span className="cselect__optlabel">{alt.title}</span>
                </button>
              ))}
            </FloatingLayer>
          );
        })()}

      {/* The "Skip days…" picker — upcoming series occurrences as toggle chips.
          Resolves the live series from the store so a stale seriesId self-closes;
          a batch skip lands as one commit + undo. Cursor-anchored FloatingLayer. */}
      {skipPicker &&
        (() => {
          const series = eventsInSeries(events, skipPicker.seriesId);
          if (!series.length) return null;
          const today = todayKey();
          const upcoming = series
            .filter((e) => e.date >= today)
            .map((e) => e.date)
            .sort();
          const dates = upcoming.length ? upcoming : series.map((e) => e.date).sort();
          return (
            <FloatingLayer
              anchor={{ kind: "point", x: skipPicker.point.x, y: skipPicker.point.y }}
              onClose={() => setSkipPicker(null)}
              className="cal-popover cal-skipdays"
              role="dialog"
              ariaLabel="Skip days"
            >
              <SkipDaysPicker
                dates={dates}
                onSkip={(chosen) => skipManyDays(skipPicker.seriesId, chosen)}
                onClose={() => setSkipPicker(null)}
              />
            </FloatingLayer>
          );
        })()}

      {/* The scope dialog: the deliberate "Delete entire series…" safety hatch
          (a right-click item — its instant skip-this-day path covers "this"
          everywhere else), AND (quickadd-1/2) the editor's save when a series
          member's REPEAT RULE changed or cleared — an unchanged rule still
          commits instantly as "this" (see saveDraft), but a changed rule now
          asks rather than silently auto-picking "following". Both modes offer
          following/all only ("this" has its own instant path in each case). */}
      {scopePrompt?.mode === "delete" && (
        <SeriesScopeDialog
          action="delete"
          title={scopePrompt.event.title}
          scopes={["following", "all"]}
          onPick={(scope) => commitSeriesDelete(scopePrompt.event, scope)}
          onClose={() => setScopePrompt(null)}
        />
      )}
      {scopePrompt?.mode === "edit" && (
        <SeriesScopeDialog
          action="edit"
          title={scopePrompt.event.title}
          scopes={["following", "all"]}
          onPick={(scope) => commitScopedEdit(scopePrompt, scope)}
          onClose={() => setScopePrompt(null)}
        />
      )}

      {/* Touch selection bar — the bulk-action surface for COARSE pointers only.
          Right-click (the desktop bulk entry) doesn't fire on a touch tap, so
          phones/tablets reach the same bulk mutations here: Delete the selection
          and Clear it. Pointer-fine devices use the right-click bulk menu instead,
          so this stays hidden there (CSS gates it to (pointer: coarse)). Staffing
          is enforced by deleteSelection. */}
      {selection.size > 1 && (
        <div className="calshell__selbar" role="toolbar" aria-label="Selected events">
          <span className="calshell__selcount">
            {selection.size} {selection.size === 1 ? "event" : "events"}
          </span>
          <button type="button" className="btn btn--ghost calshell__seldanger" onClick={deleteSelection}>
            Delete
          </button>
          <button type="button" className="btn btn--ghost" onClick={clearSelection}>
            Clear
          </button>
        </div>
      )}

      {toast &&
        (() => {
          // Fold the legacy single `action` into the ordered `actions` list so
          // both shapes render through one path (escalation buttons, then Undo).
          const actions = [...(toast.action ? [toast.action] : []), ...(toast.actions ?? [])];
          return (
            <div className="calshell__toast" role="status">
              <span>{toast.message}</span>
              {actions.map((action, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    action.onClick();
                    setToast(null);
                  }}
                >
                  {action.label}
                </button>
              ))}
              {toast.onUndo && (
                <button
                  type="button"
                  onClick={() => {
                    toast.onUndo?.();
                    setToast(null);
                  }}
                >
                  Undo
                </button>
              )}
            </div>
          );
        })()}
    </div>
  );
}

// A small inline pushpin, shared by the "Pin in place" / "Unpin" menu item and
// the pinned-event card glyph. CampIcon.Pin is the location MAP-pin (semantically
// wrong for holding an event in place), and icons.tsx is owned elsewhere, so the
// pushpin is inlined here on the shared 24×24 stroke grid the icon set uses
// (currentColor via CSS).
function PinInPlaceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z" />
      <path d="M12 17v3" />
    </svg>
  );
}
// The card variant is the same glyph — a distinct name at the call site keeps the
// two uses legible (a menu item's icon vs a card affordance).
const CardPinGlyph = PinInPlaceIcon;

// A tiny "edited" tick — a small pencil — worn by a "this"-customized series
// member's card beside the repeat loop. Inlined on the icon set's 24×24 stroke
// grid (icons.tsx is owned elsewhere), tone from the card's own color.
function EditedTickGlyph({ className }: { className?: string }) {
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
function KitGlyph({ className }: { className?: string }) {
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
function BackupUmbrellaGlyph({ className }: { className?: string }) {
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
function BulkLocationPicker({
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
function SkipDaysPicker({
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
function GatherPopover({
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
function RainPanel({
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
