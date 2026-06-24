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
  EventMountArg,
} from "@fullcalendar/core";
import type { DateClickArg, EventReceiveArg, EventResizeDoneArg } from "@fullcalendar/interaction";
import { fromFcDates, healEvent, toFcEvent } from "@/lib/calendar/adapter";
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
  snapMinutes,
  type DayWindow,
} from "@/lib/calendar/time";
import type { ThemeResolver } from "@/lib/calendar/adapter";
import { isColorMode, type ColorMode } from "@/lib/data";
import type { CalendarEvent, DateKey } from "@/lib/calendar/types";
import {
  buildSeriesEvents,
  eventsInSeries,
  planSeriesDelete,
  planSeriesEdit,
  planSeriesSkip,
  recurrenceDates,
  type RecurrenceRule,
  type SeriesScope,
  type SeriesTemplate,
} from "@/lib/calendar/recurrence";
import type { Activity } from "@/lib/types";
import { useLocalStorage } from "@/lib/store";
import { CampIcon } from "../icons";
import { Modal } from "../Modal";
import { ContextMenu } from "../floating/ContextMenu";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarViewSettings } from "./CalendarViewSettings";
import { EventPopover } from "./EventPopover";
import { MiniMonth } from "./MiniMonth";
import { QuickAdd, draftFromEvent, type EditorDraft } from "./QuickAdd";
import { SeriesScopeDialog } from "./SeriesScopeDialog";

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

type PopoverState = { event: CalendarEvent; anchor: DOMRect };
type MenuState = { event: CalendarEvent; point: { x: number; y: number } };
type ToastState = { message: string; onUndo?: () => void };
// Editing or deleting one occurrence of a repeating event first asks the scope
// (this / following / all). The pending action is held here until the user picks.
type ScopePrompt =
  | { mode: "edit"; event: CalendarEvent; draft: EditorDraft }
  | { mode: "delete"; event: CalendarEvent };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const boolStorage = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const slotZoomStorage = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? clampSlotZoom(value) : fallback;

// Validate the stored "Color by" mode against the known ids (mirrors
// parseWeekStart/boolStorage) so a stale/garbage value falls back to "custom".
const colorModeStorage = (value: unknown, fallback: ColorMode) =>
  isColorMode(value) ? value : fallback;

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
  dayWindow,
  headerActions,
  themeOf,
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
  /** The base visible window (drop-off → pickup) of the active camp, or the
   *  classic 8:00–18:00 band when no camp is active. effectiveWindow only ever
   *  stretches this outward around events. Computed by CampApp from the active
   *  camp's hours, which now live on the (synced) camp object. */
  dayWindow: DayWindow;
  /** Header-cluster slot for camp-scoped actions composed by CampApp (where the
   *  camp data lives) — currently the Subscribe / .ics feed pill. */
  headerActions?: ReactNode;
  /** Resolves an activity's theme, for the per-event theme badge (events reflect
   *  their activity's theme). */
  themeOf: ThemeResolver;
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
  const [sheet, setSheet] = useState<{ draft: EditorDraft; pickTime: boolean } | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Shift/Cmd-click multi-selection (Finder/Notion semantics): the SET of
  // selected event ids, plus a FIXED anchor that a shift-click re-extends the
  // range from. Selection is purely a view affordance — it never touches stored
  // data; only Delete acts on it (bulk). A plain click collapses it to one.
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  // The pending repeating-event edit/delete awaiting a scope choice.
  const [scopePrompt, setScopePrompt] = useState<ScopePrompt | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const focusDateRef = useRef<DateKey>(todayKey());

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

  // Which days carry at least one event in the active camp — the mini-month
  // dots each of these so the sidebar previews where the schedule is busy.
  const eventDays = useMemo(() => {
    const days = new Set<string>();
    for (const event of healedEvents) days.add(event.date);
    return days;
  }, [healedEvents]);

  // Every event id in chronological order — (date, then startMin, then id as a
  // stable tiebreak). This is the spine a shift-click range walks: "in between"
  // is simply the slice of this order between anchor and target, so a range
  // spans days naturally (anchor Mon 9:00 → target Wed 14:00 sweeps in Tue).
  // Ordered from the in-memory event set, independent of what's scrolled in.
  const orderedEventIds = useMemo(() => {
    return [...healedEvents]
      .sort(
        (a, b) =>
          (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
          a.startMin - b.startMin ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )
      .map((event) => event.id);
  }, [healedEvents]);
  // onEventClick reads the order + anchor through refs so it can stay a STABLE
  // callback: it's a dep of the heavy FullCalendar memo, and we don't want a
  // re-anchor (every click) or an event change to re-render the whole grid just
  // to refresh this closure. (fcEvents already triggers the grid on data change.)
  const orderedEventIdsRef = useRef(orderedEventIds);
  orderedEventIdsRef.current = orderedEventIds;
  const selectionAnchorRef = useRef(selectionAnchor);
  selectionAnchorRef.current = selectionAnchor;

  // Drop the multi-selection (set + anchor) back to empty. Called on every
  // gesture that should reset the selection: a plain background/date click, a
  // drag-create, a view change, Escape, and opening a popover.
  const clearSelection = useCallback(() => {
    setSelection((prev) => (prev.size ? new Set() : prev));
    setSelectionAnchor(null);
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

  // The base window is the active camp's hours (drop-off → pickup), or the classic
  // 8:00–18:00 band with no active camp — passed in as `dayWindow`. Auto-extend
  // only ever stretches it outward around events in the rendered STRIP (stable
  // while you scroll, so the grid hours don't jitter), not the live visible
  // sub-range — a stray 6am event elsewhere shouldn't stretch every day forever.
  const window_ = useMemo(() => {
    const stripEnd = stripStart ? addDays(stripStart, STRIP_DAYS) : null;
    const scoped =
      stripStart && stripEnd
        ? healedEvents.filter((event) => event.date >= stripStart && event.date < stripEnd)
        : healedEvents;
    return effectiveWindow(scoped, dayWindow);
  }, [healedEvents, stripStart, dayWindow]);

  // Re-tints every event by the active "Color by" mode. A colorMode change
  // recomputes this memo, which (because each EventInput now carries a new
  // extendedProps.tint) flows through renderEventContent's paint() — the same
  // repaint path a per-event recolor already uses — so picking a mode recolors
  // the visible cards immediately, no scroll/refresh needed.
  const fcEvents = useMemo(
    () => healedEvents.map((event) => toFcEvent(event, byId, themeOf, colorMode)),
    [healedEvents, byId, themeOf, colorMode]
  );

  const scrollTime = useMemo(() => {
    const anchor = Math.max(window_.startMin, Math.min(nowMinutes() - 90, window_.endMin - 120));
    return minutesToTimeString(anchor);
  }, [window_]);

  // The grid is DRAWN from the enclosing whole hour so the hourly slot labels —
  // and the darker hour gridlines — land on real clock hours even when camp
  // hours open on a half-hour like 7:30. FullCalendar anchors slotLabelInterval
  // at slotMinTime, so a 7:30 start would otherwise label 7:30 / 8:30 / 9:30.
  // window_ itself (which the editor's start/length pickers read) is untouched.
  const gridStart = useMemo(() => Math.floor(window_.startMin / 60) * 60, [window_]);
  const gridEnd = useMemo(() => Math.ceil(window_.endMin / 60) * 60, [window_]);

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
    setPopover(null);
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
    (draft: EditorDraft, campId?: string): SeriesTemplate => {
      const activity = draft.activityId ? byId[draft.activityId] : undefined;
      const endMin = Math.min(MINUTES_PER_DAY, draft.startMin + snapDurationMin(draft.durationMin));
      const template: SeriesTemplate = {
        startMin: draft.allDay ? 0 : draft.startMin,
        endMin: draft.allDay ? 0 : endMin,
        allDay: draft.allDay,
        kind: activity ? "activity" : "custom",
        title: activity?.title ?? draft.title ?? "Untitled",
        campId,
      };
      if (activity) template.activityId = activity.id;
      if (draft.color) template.color = draft.color;
      if (draft.locations?.length) template.locations = draft.locations;
      return template;
    },
    [byId]
  );

  // Materialize a brand-new repeating event into one occurrence per date. The
  // anchor (the event you were composing) keeps its id; the rest are fresh. The
  // whole series is one batch write, so a single Undo removes it.
  const createSeries = useCallback(
    (draft: EditorDraft, rule: RecurrenceRule, existing?: CalendarEvent) => {
      const template = buildTemplate(draft, existing?.campId);
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

  const saveDraft = useCallback(
    (draft: EditorDraft) => {
      if (!requireStaff("plan the calendar")) return;
      const existing = draft.id ? events[draft.id] : undefined;
      // Editing an event that already belongs to a series → ask the scope first.
      if (existing?.seriesId) {
        setScopePrompt({ mode: "edit", event: existing, draft });
        return;
      }
      // A new (or previously one-off) event gaining a repeat → build the series.
      if (draft.recurrence) {
        createSeries(draft, draft.recurrence, existing);
        return;
      }
      const activity = draft.activityId ? byId[draft.activityId] : undefined;
      const endMin = Math.min(MINUTES_PER_DAY, draft.startMin + snapDurationMin(draft.durationMin));
      const event: CalendarEvent = {
        id: draft.id ?? crypto.randomUUID(),
        date: draft.date,
        startMin: draft.allDay ? 0 : draft.startMin,
        endMin: draft.allDay ? 0 : endMin,
        kind: activity ? "activity" : "custom",
        title: activity?.title ?? draft.title ?? "Untitled",
        updatedAt: Date.now(),
      };
      if (activity) event.activityId = activity.id;
      if (draft.allDay) event.allDay = true;
      if (draft.color) event.color = draft.color;
      if (draft.locations?.length) event.locations = draft.locations;
      upsertEvent(event);
      setSheet(null);
      announce((draft.id ? "Updated " : "Added ") + event.title);
      if (!draft.id) {
        showToast({
          message: "Added " + event.title + (event.allDay ? " · all day" : " · " + formatClock(event.startMin)),
          onUndo: () => removeEvent(event.id),
        });
      }
    },
    [announce, byId, createSeries, events, removeEvent, requireStaff, showToast, upsertEvent]
  );

  const deleteEvent = useCallback(
    (event: CalendarEvent) => {
      if (!requireStaff("change the calendar")) return;
      // A repeating event asks the scope (this / following / all) before deleting.
      if (event.seriesId) {
        setPopover(null);
        setScopePrompt({ mode: "delete", event });
        return;
      }
      removeEvent(event.id);
      setPopover(null);
      setSheet(null);
      showToast(
        {
          message: "Deleted " + (event.title || "event"),
          onUndo: () => upsertEvent({ ...event, updatedAt: Date.now() }),
        },
        8000
      );
      announce("Deleted " + event.title);
    },
    [announce, removeEvent, requireStaff, showToast, upsertEvent]
  );

  // Bulk-delete the whole multi-selection as ONE undoable step. Each occurrence
  // is treated as a plain single-day delete — we deliberately do NOT pop the
  // recurring this/following/all dialog here (a bulk delete is predictable: what
  // you selected is exactly what goes), and the single Undo restores them all.
  const deleteSelection = useCallback(() => {
    if (!requireStaff("change the calendar")) return;
    // Snapshot the live events for the selected ids, skipping any that no longer
    // exist, so Undo can restore the exact rows (color/series fields and all).
    const before: CalendarEvent[] = [];
    for (const id of selection) {
      const event = events[id];
      if (event) before.push(healEvent(event, byId));
    }
    if (!before.length) return;
    const ids = before.map((event) => event.id);
    removeEvents(ids);
    clearSelection();
    setPopover(null);
    setSheet(null);
    const count = ids.length;
    const label = "Deleted " + count + (count === 1 ? " event" : " events");
    announce(label);
    showToast(
      {
        message: label,
        // Restore every removed row in one step (stamp updatedAt so the
        // last-write-wins store re-accepts them after the delete).
        onUndo: () => upsertEvents(before.map((event) => ({ ...event, updatedAt: Date.now() }))),
      },
      8000
    );
  }, [announce, byId, clearSelection, events, removeEvents, requireStaff, selection, showToast, upsertEvents]);

  // Commit a scoped edit of a repeating event once the user picks this/following/
  // all. The whole affected slice is replaced in one batch; Undo snapshots the
  // pre-edit series and restores it (clearing whatever the edit produced).
  const commitSeriesEdit = useCallback(
    (prompt: Extract<ScopePrompt, { mode: "edit" }>, scope: SeriesScope) => {
      const seriesId = prompt.event.seriesId;
      if (!seriesId) return;
      const before = eventsInSeries(events, seriesId);
      const template = buildTemplate(prompt.draft, prompt.event.campId);
      const plan = planSeriesEdit(
        before,
        prompt.event,
        template,
        prompt.draft.date,
        prompt.draft.recurrence,
        scope,
        () => crypto.randomUUID()
      );
      // One atomic commit (regenerated occurrences upserted, old ones removed) so
      // the whole scoped edit is a single undo step.
      commitEvents(plan.upserts, plan.removes);
      setScopePrompt(null);
      setSheet(null);
      announce("Updated " + template.title);
      const beforeIds = new Set(before.map((event) => event.id));
      const newIds = plan.upserts.map((event) => event.id).filter((id) => !beforeIds.has(id));
      const scopeNote = scope === "this" ? "" : scope === "all" ? " · all events" : " · this & following";
      showToast(
        {
          message: "Updated " + template.title + scopeNote,
          // Restore the pre-edit series and drop the occurrences the edit added,
          // in one step (mirrors the single-commit edit above).
          onUndo: () => commitEvents(before, newIds),
        },
        8000
      );
    },
    [announce, buildTemplate, commitEvents, events]
  );

  const commitSeriesDelete = useCallback(
    (event: CalendarEvent, scope: SeriesScope) => {
      const seriesId = event.seriesId;
      if (!seriesId) return;
      const series = eventsInSeries(events, seriesId);
      if (scope === "this") {
        // Skip a single occurrence: remove it AND record its date as an exdate on
        // the surviving occurrences, so a later "all"/"following" edit doesn't
        // resurrect it (the EXDATE-survives-edits guarantee). One atomic step.
        const plan = planSeriesSkip(series, event);
        commitEvents(plan.upserts, plan.removes);
        setScopePrompt(null);
        setPopover(null);
        setSheet(null);
        announce("Skipped " + (event.title || "event"));
        showToast(
          { message: "Skipped this day", onUndo: () => commitEvents(series, []) },
          8000
        );
        return;
      }
      const ids = planSeriesDelete(series, event, scope);
      const before = series.filter((occurrence) => ids.includes(occurrence.id));
      removeEvents(ids);
      setScopePrompt(null);
      setPopover(null);
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
    [announce, commitEvents, events, removeEvents, upsertEvents]
  );

  // Duplicate an event: clone it onto the next free slot of the same day so the
  // copy doesn't sit exactly on top of the original; fall back to the same start
  // if the day is full. Undoable like every other calendar mutation.
  const duplicateEvent = useCallback(
    (event: CalendarEvent) => {
      if (!requireStaff("plan the calendar")) return;
      const duration = snapDurationMin(event.endMin - event.startMin);
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
      // original's series — drop the recurrence so it isn't tied to it.
      delete copy.seriesId;
      delete copy.recurrence;
      upsertEvent(copy);
      setPopover(null);
      announce("Duplicated " + (event.title || "event"));
      showToast({
        message: "Duplicated " + (event.title || "event"),
        onUndo: () => removeEvent(copy.id),
      });
    },
    [announce, healedEvents, removeEvent, requireStaff, showToast, upsertEvent, window_]
  );

  // The Add button (header on desktop, FAB on mobile): the event composer with
  // nothing prechosen. Picking a library activity happens inside QuickAdd.
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
      const startMin = snapMinutes(minutesOfDay(info.date), SNAP_MIN);
      // A single tap gives no span — the chosen activity's recommended length applies.
      setSheet({
        draft: {
          date: toDateKey(info.date),
          startMin,
          durationMin: DEFAULT_DURATION_MIN,
          allDay: info.allDay,
          title: "",
          explicitDuration: false,
        },
        pickTime: false,
      });
    },
    [clearSelection, requireStaff, setStoredView]
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

  const quickAddCustom = useCallback(
    (title: string) => {
      const draft = sheet?.draft;
      if (!draft || !requireStaff("plan the calendar")) return;
      const startMin = draft.allDay ? 0 : draft.startMin;
      const event: CalendarEvent = {
        id: crypto.randomUUID(),
        date: draft.date,
        startMin,
        endMin: draft.allDay ? 0 : Math.min(MINUTES_PER_DAY, startMin + snapDurationMin(draft.durationMin)),
        kind: "custom",
        title,
        updatedAt: Date.now(),
      };
      if (draft.allDay) event.allDay = true;
      upsertEvent(event);
      setSheet(null);
      announce("Added " + title);
      showToast({
        message: "Added " + title + (event.allDay ? " · all day" : " · " + formatClock(startMin)),
        onUndo: () => removeEvent(event.id),
      });
    },
    [announce, sheet, removeEvent, requireStaff, showToast, upsertEvent]
  );

  const onEventClick = useCallback(
    (info: EventClickArg) => {
      info.jsEvent.preventDefault();
      const event = events[info.event.id];
      if (!event) return;
      const id = info.event.id;
      const shift = info.jsEvent.shiftKey;
      const toggle = info.jsEvent.metaKey || info.jsEvent.ctrlKey;

      // SHIFT — range-select from the FIXED anchor to this event, inclusive, in
      // chronological order (so it spans days). The anchor stays put, so a
      // second shift-click re-extends the range from the same origin
      // (Finder/Notion). With no anchor yet, this just selects + anchors here.
      // Never opens the popover.
      if (shift) {
        setPopover(null);
        const order = orderedEventIdsRef.current;
        const anchor = selectionAnchorRef.current;
        if (!anchor || anchor === id) {
          setSelection(new Set([id]));
          setSelectionAnchor(id);
          return;
        }
        const ai = order.indexOf(anchor);
        const bi = order.indexOf(id);
        if (ai === -1 || bi === -1) {
          setSelection(new Set([id]));
          setSelectionAnchor(id);
          return;
        }
        const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
        setSelection(new Set(order.slice(lo, hi + 1)));
        return; // anchor unchanged
      }

      // CMD/CTRL — toggle just this event in/out of the selection and make it
      // the new anchor (so a following shift-click extends from here). No popover.
      if (toggle) {
        setPopover(null);
        setSelection((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setSelectionAnchor(id);
        return;
      }

      // PLAIN click — collapse any multi-selection to just this event (it becomes
      // the new anchor) and open its popover, the unchanged default behaviour.
      setSelection(new Set([id]));
      setSelectionAnchor(id);
      setPopover({ event: healEvent(event, byId), anchor: info.el.getBoundingClientRect() });
    },
    [byId, events]
  );

  // Right-click an event → themed context menu at the cursor. Delegated on the
  // grid (FullCalendar's event DOM isn't React-owned), resolving the event from
  // the id stamped in onEventDidMount. Pointer-fine only; touch users get the
  // same actions via the tap-opened popover.
  const onGridContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (typeof window !== "undefined" && !window.matchMedia("(pointer: fine)").matches) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-event-id]");
      const id = el?.dataset.eventId;
      if (!id) return;
      const event = events[id];
      if (!event) return;
      e.preventDefault();
      setPopover(null);
      setMenu({ event: healEvent(event, byId), point: { x: e.clientX, y: e.clientY } });
    },
    [byId, events]
  );

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
    // Free follow: top-left tracks the cursor minus where it was grabbed.
    follow.style.left = pointerRef.current.x - grabOffsetRef.current.dx + "px";
    follow.style.top = pointerRef.current.y - grabOffsetRef.current.dy + "px";
    follow.style.opacity = "1";
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
    }
    sourceHarnessRef.current?.classList.remove("is-drag-source");
    sourceHarnessRef.current = null;
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
      const next = fromFcDates(info.event.start, info.event.end, info.event.allDay, existing);
      // Option/Alt held at drop → drop a COPY at the new slot and leave the
      // original untouched (macOS option-drag duplicate). Read at drop time so
      // pressing/releasing Option mid-drag decides copy vs move; altDragRef is the
      // live-tracked fallback when the drop event carries no modifier state.
      if (info.jsEvent?.altKey || altDragRef.current) {
        info.revert();
        const copy: CalendarEvent = { ...next, id: crypto.randomUUID(), updatedAt: Date.now() };
        upsertEvent(copy);
        announce("Copied " + (existing.title || "event"));
        showToast({
          message: "Copied " + (existing.title || "event"),
          onUndo: () => removeEvent(copy.id),
        });
        return;
      }
      // A repeating occurrence: ask the scope (this / following / all) — the same
      // choice the editor offers — instead of silently rewriting only this one
      // day. Route the new geometry through the existing scoped-edit flow as a
      // draft. Revert FC's optimistic move first: the scoped commit re-renders the
      // series, and a cancelled prompt then leaves the occurrence where it was.
      if (existing.seriesId) {
        info.revert();
        setScopePrompt({ mode: "edit", event: existing, draft: draftFromEvent(next) });
        return;
      }
      upsertEvent(next);
      announce("Moved " + (existing.title || "event") + " to " + formatClock(next.startMin));
    },
    [announce, events, removeEvent, requireStaff, showToast, upsertEvent]
  );

  const onEventResize = useCallback(
    (info: EventResizeDoneArg) => {
      const existing = events[info.event.id];
      if (!existing || !info.event.start || !requireStaff("resize events")) {
        info.revert();
        return;
      }
      const next = fromFcDates(info.event.start, info.event.end, info.event.allDay, existing);
      // Resizing a repeating occurrence asks the scope too, mirroring the drag
      // and the editor — so "all events" can adopt the new length in one step.
      if (existing.seriesId) {
        info.revert();
        setScopePrompt({ mode: "edit", event: existing, draft: draftFromEvent(next) });
        return;
      }
      upsertEvent(next);
      announce((existing.title || "Event") + " now ends at " + formatClock(next.endMin));
    },
    [announce, events, requireStaff, upsertEvent]
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
      let startMin = allDay ? 0 : snapMinutes(minutesOfDay(start), SNAP_MIN);
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
    [announce, byId, healedEvents, removeEvent, requireStaff, showToast, upsertEvent, window_]
  );

  // Tint flows through a CSS variable so the stylesheet can mix it with paper.
  const onEventDidMount = useCallback((info: EventMountArg) => {
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
    const tint = arg.event.extendedProps.tint;
    const themeTint = arg.event.extendedProps.themeTint;
    const isCustom = arg.event.extendedProps.kind === "custom";
    // Where the block happens (gym, field…), shown under the time on taller
    // cards. The card is a size container, so a short block simply clips it.
    const locationText = arg.event.extendedProps.location;
    const location = typeof locationText === "string" && locationText ? locationText : null;

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
          {repeats && <CampIcon.Repeat className="cal-chip__repeat" />}
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
          {repeats && <CampIcon.Repeat className="cal-card__repeat" />}
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
  }, []);

  // Paint the multi-selection onto FullCalendar's (non-React) event DOM. The
  // cards aren't ours to render a className onto, so — like the contextmenu id
  // stamp and the drag-source dimming — we reach into the grid and toggle a
  // DEDICATED class (cal-event--selected, NOT FC's own .fc-event-selected, which
  // its native single-select ring would clash with) on every [data-event-id]
  // harness to match the set. Re-runs whenever the selection changes OR fcEvents
  // rebuilds the DOM (a recolor / add / remove), deferred a frame so it lands
  // after FC has committed its render. The same id can appear twice (a card in
  // both the strip and a re-anchor overlap), so we walk ALL matching nodes.
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

  // Google-style day headers: "MON" over the date numeral, today circled.
  const renderDayHeader = useCallback((arg: DayHeaderContentArg) => {
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
    return (
      <div className={"cal-dayhead" + (arg.isToday ? " is-today" : "")}>
        <span className="cal-dayhead__dow">{weekday}</span>
        <span className="cal-dayhead__num">{arg.date.getDate()}</span>
      </div>
    );
  }, []);

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
    }
    if (day) realignTo(day);
  }, [dayWidth, realignTo]);

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

  // Keyboard shortcuts, matching Notion Calendar: t today; d/1 Day, w/0 Week,
  // m Month, 2–9 an N-day window; j/→ next, k/← previous (slide-and-snap).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // Delete / Backspace. Two paths, both suppressed while an editor sheet or
      // the scope prompt is up:
      //   · a multi-selection (shift/cmd-click, no popover) → delete them ALL in
      //     one undoable step ("Deleted N events");
      //   · otherwise the single event whose popover is open (a plain click both
      //     selects and opens it) → the existing per-event delete (which still
      //     routes a recurring event through the this/following/all scope dialog).
      if ((event.key === "Backspace" || event.key === "Delete") && !sheet && !scopePrompt) {
        if (!popover && selection.size) {
          event.preventDefault();
          deleteSelection();
          return;
        }
        if (popover) {
          event.preventDefault();
          deleteEvent(popover.event);
          return;
        }
      }
      // Undo / redo: Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, scoped to the calendar.
      // Handled BEFORE the modifier early-return below. Suppressed while an
      // editing surface is open so the sheet's own fields keep native undo (and
      // a stray Cmd+Z doesn't rewrite the calendar out from under an open editor).
      if ((event.metaKey || event.ctrlKey) && (event.key === "z" || event.key === "Z")) {
        if (sheet || popover || settingsOpen || scopePrompt) return;
        event.preventDefault();
        if (event.shiftKey) {
          if (redo()) announce("Redid the last change");
        } else if (undo()) {
          announce("Undid the last change");
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (sheet || popover || settingsOpen || scopePrompt) return;
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
  }, [changeView, goToday, nudge, deleteEvent, deleteSelection, selection, undo, redo, announce, sheet, popover, settingsOpen, scopePrompt]);

  // Escape clears the multi-selection. We honour the app's capture-phase Escape
  // contract (see FloatingLayer/useDialogFocus): a capture listener that runs
  // FIRST but BAILS on defaultPrevented, then preventDefault()s itself so any
  // bubble-phase dialog underneath stays untouched. Only armed when there's a
  // real selection AND nothing is open over it — a popover/menu/sheet/scope
  // prompt owns its own Escape (close the layer first), and a plain click leaves
  // a 1-item selection beneath an open popover that this must NOT swallow.
  useEffect(() => {
    if (!selection.size || popover || menu || sheet || scopePrompt || settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      clearSelection();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [selection, popover, menu, sheet, scopePrompt, settingsOpen, clearSelection]);

  const popoverActivity = popover?.event.activityId ? byId[popover.event.activityId] ?? null : null;

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
          eventMinHeight={22}
          snapDuration="00:15:00"
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
        actions={headerActions}
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
            <>
              <MiniMonth
                anchorDate={miniAnchor}
                viewStart={visibleRange?.start ?? null}
                viewEnd={visibleRange?.end ?? null}
                today={todayKey()}
                todayInView={todayInView}
                eventDays={eventDays}
                firstDay={weekStart}
                onPick={gotoMiniDate}
                onToday={goToday}
              />
              {/* The view settings sit under the mini-month as a persistently
                  visible switch ledger (the Library filter vocabulary) — no
                  disclosure, matching the Library's always-open filter rail.
                  Fixed height; nothing here scrolls. */}
              <div className="sidesection sidesection--fixed cal-view">
                <div className="sidesection__head">
                  <span className="sidesection__title">View</span>
                </div>
                <div className="sidesection__body cal-view__body">
                  <CalendarViewSettings
                    view={activeView}
                    colorMode={colorMode}
                    onColorMode={setColorMode}
                    shadeWeekendsOn={shadeWeekends}
                    onToggleShadeWeekends={() => setShadeWeekends((on) => !on)}
                    weekStart={weekStart}
                    onWeekStart={setWeekStart}
                    onChangeView={changeView}
                    onOpenCamps={onOpenCamps}
                  />
                </div>
              </div>
            </>,
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
          draft={sheet.draft}
          pickTime={sheet.pickTime}
          activities={activities}
          window={window_}
          onPickActivity={quickAddActivity}
          onCustom={quickAddCustom}
          onSave={saveDraft}
          onDelete={
            sheet.draft.id
              ? () => {
                  const existing = events[sheet.draft.id as string];
                  if (existing) deleteEvent(existing);
                }
              : undefined
          }
          onClose={() => setSheet(null)}
        />
      )}

      {/* Mobile's home for the view settings (desktop puts them in the sidebar).
          One CalendarViewSettings, shared state — opening Manage camps dismisses
          this sheet first so the next modal isn't stacked behind. */}
      {settingsOpen && (
        <Modal
          label="View settings"
          onClose={() => setSettingsOpen(false)}
          overlayProps={{ className: "overlay--card" }}
        >
          <div className="overlay__bar">
            <h2 className="filtersheet__title">View</h2>
          </div>
          <div className="overlay__body filtersheet">
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
            />
          </div>
        </Modal>
      )}

      {popover && (
        <EventPopover
          event={popover.event}
          activity={popoverActivity}
          theme={popoverActivity ? themeOf(popoverActivity.id) : null}
          anchor={popover.anchor}
          onOpenActivity={(activity) => {
            setPopover(null);
            onOpenActivity(activity, popover.event);
          }}
          onEdit={() => {
            if (!requireStaff("change the calendar")) return;
            setSheet({ draft: draftFromEvent(popover.event), pickTime: true });
            setPopover(null);
          }}
          onDuplicate={() => duplicateEvent(popover.event)}
          onDelete={() => deleteEvent(popover.event)}
          onClose={() => setPopover(null)}
        />
      )}

      {menu && (
        <ContextMenu
          point={menu.point}
          ariaLabel={menu.event.title || "Event"}
          onClose={() => setMenu(null)}
          items={[
            ...(menu.event.activityId && byId[menu.event.activityId]
              ? [
                  {
                    label: "Open Run List",
                    icon: <CampIcon.BookOpen />,
                    onSelect: () => {
                      const activity = byId[menu.event.activityId as string];
                      if (activity) onOpenActivity(activity, menu.event);
                    },
                  },
                ]
              : []),
            {
              label: "Edit",
              icon: <CampIcon.Pencil />,
              onSelect: () => {
                if (!requireStaff("change the calendar")) return;
                setSheet({ draft: draftFromEvent(menu.event), pickTime: true });
              },
            },
            {
              // The right-click way into recurrence: opens the editor where the
              // Repeat control lives (reads "Edit repeat…" once a rule is set).
              label: menu.event.recurrence ? "Edit repeat…" : "Repeat…",
              icon: <CampIcon.Repeat />,
              onSelect: () => {
                if (!requireStaff("change the calendar")) return;
                setSheet({ draft: draftFromEvent(menu.event), pickTime: true });
              },
            },
            {
              label: "Duplicate",
              icon: <CampIcon.Copy />,
              onSelect: () => duplicateEvent(menu.event),
            },
            {
              label: "Delete",
              icon: <CampIcon.Trash />,
              danger: true,
              separatorBefore: true,
              onSelect: () => deleteEvent(menu.event),
            },
          ]}
        />
      )}

      {scopePrompt && (
        <SeriesScopeDialog
          action={scopePrompt.mode}
          title={scopePrompt.event.title}
          onPick={(scope) =>
            scopePrompt.mode === "edit"
              ? commitSeriesEdit(scopePrompt, scope)
              : commitSeriesDelete(scopePrompt.event, scope)
          }
          onClose={() => setScopePrompt(null)}
        />
      )}

      {toast && (
        <div className="calshell__toast" role="status">
          <span>{toast.message}</span>
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
      )}
    </div>
  );
}
