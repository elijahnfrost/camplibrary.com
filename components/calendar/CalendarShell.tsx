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
} from "@/lib/calendar/time";
import type { ThemeResolver } from "@/lib/calendar/adapter";
import {
  DEFAULT_CAMP_HOURS,
  campHoursStorage,
  windowFromCampHours,
  type CampHoursMap,
} from "@/lib/calendar/hours";
import type { CalendarEvent, DateKey } from "@/lib/calendar/types";
import type { Activity } from "@/lib/types";
import { useLocalStorage } from "@/lib/store";
import { CampIcon } from "../icons";
import { Modal } from "../Modal";
import { ContextMenu } from "../floating/ContextMenu";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarViewSettings } from "./CalendarViewSettings";
import { EventPopover } from "./EventPopover";
import { HoursPanel } from "./HoursPanel";
import { MiniMonth } from "./MiniMonth";
import { QuickAdd, draftFromEvent, type EditorDraft } from "./QuickAdd";

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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const boolStorage = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

export function CalendarShell({
  events,
  upsertEvent,
  removeEvent,
  activities,
  byId,
  canEdit,
  requireStaff,
  onOpenActivity,
  announce,
  railSlot,
  onOpenCamps,
  headerActions,
  themeOf,
}: {
  events: Record<string, CalendarEvent>;
  upsertEvent: (event: CalendarEvent) => void;
  removeEvent: (id: string) => void;
  activities: Activity[];
  byId: Record<string, Activity>;
  canEdit: boolean;
  requireStaff: (action: string) => boolean;
  onOpenActivity: (activity: Activity, eventContext: CalendarEvent) => void;
  announce: (message: string) => void;
  /** Desktop: the left-sidebar slot the mini-month + View settings render into
   *  (one sidebar shared with the Library tab's filters). Null on mobile. */
  railSlot?: HTMLElement | null;
  /** Opens the camp manager (add / switch / rename / delete). Lives in the
   *  sidebar's View settings, so the header has no camp pill. */
  onOpenCamps: () => void;
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
  // Camp hours: the editable per-camp drop-off/pickup that sets how far the day
  // is viewed. A local view preference (like the stored view), so it lives in
  // localStorage and never gates on staff.
  const [campHours, setCampHours] = useLocalStorage<CampHoursMap>(
    "calendarHours",
    DEFAULT_CAMP_HOURS,
    campHoursStorage
  );
  const [hoursOpen, setHoursOpen] = useState(false);
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

  // The base window comes from the configured camp hours (union of the enabled
  // camps' drop-off → pickup); auto-extend only ever stretches it outward.
  const campWindow = useMemo(() => windowFromCampHours(campHours), [campHours]);

  // The day window auto-extends around events in the rendered STRIP (stable while
  // you scroll, so the grid hours don't jitter), not the live visible sub-range —
  // a stray 6am event elsewhere shouldn't stretch every day's grid forever.
  const window_ = useMemo(() => {
    const stripEnd = stripStart ? addDays(stripStart, STRIP_DAYS) : null;
    const scoped =
      stripStart && stripEnd
        ? healedEvents.filter((event) => event.date >= stripStart && event.date < stripEnd)
        : healedEvents;
    return effectiveWindow(scoped, campWindow);
  }, [healedEvents, stripStart, campWindow]);

  const fcEvents = useMemo(
    () => healedEvents.map((event) => toFcEvent(event, byId, themeOf)),
    [healedEvents, byId, themeOf]
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
    [firstVisibleDay, setStoredView]
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

  const saveDraft = useCallback(
    (draft: EditorDraft) => {
      if (!requireStaff("plan the calendar")) return;
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
    [announce, byId, removeEvent, requireStaff, showToast, upsertEvent]
  );

  const deleteEvent = useCallback(
    (event: CalendarEvent) => {
      if (!requireStaff("change the calendar")) return;
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
    [requireStaff, showToast]
  );

  const onDateClick = useCallback(
    (info: DateClickArg) => {
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
    [requireStaff, setStoredView]
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
    follow.style.width = r.width + "px";
    follow.style.height = r.height + "px";
    // Free follow: top-left tracks the cursor minus where it was grabbed.
    follow.style.left = pointerRef.current.x - grabOffsetRef.current.dx + "px";
    follow.style.top = pointerRef.current.y - grabOffsetRef.current.dy + "px";
    follow.style.opacity = "1";
  }, []);

  const addPointerSafetyNet = useCallback(
    (onEnd: () => void) => {
      const onMove = (e: PointerEvent) => {
        pointerRef.current = { x: e.clientX, y: e.clientY };
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      window.addEventListener("blur", onEnd);
      dragCleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        window.removeEventListener("blur", onEnd);
      };
    },
    []
  );

  const stopDragAffordance = useCallback(() => {
    document.body.classList.remove("is-cal-dragging");
    document.body.classList.remove("is-cal-resizing");
    if (dragRafRef.current != null) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    if (followRef.current) {
      followRef.current.style.opacity = "0";
      followRef.current.innerHTML = "";
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
      addPointerSafetyNet(stopDragAffordance);
    },
    [addPointerSafetyNet, stopDragAffordance, traceFollower]
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
      upsertEvent(next);
      announce("Moved " + (existing.title || "event") + " to " + formatClock(next.startMin));
    },
    [announce, events, requireStaff, upsertEvent]
  );

  const onEventResize = useCallback(
    (info: EventResizeDoneArg) => {
      const existing = events[info.event.id];
      if (!existing || !info.event.start || !requireStaff("resize events")) {
        info.revert();
        return;
      }
      const next = fromFcDates(info.event.start, info.event.end, info.event.allDay, existing);
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

    if (arg.view.type === "dayGridMonth") {
      // One left spine carries the category colour (the .fc-daygrid-event
      // border-left); no inner tick on top of it.
      return (
        <div className="cal-chip">
          {!arg.event.allDay && <span className="cal-chip__time">{arg.timeText}</span>}
          <span className="cal-chip__title">{arg.event.title}</span>
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
      <div className="cal-card">
        <span className="cal-card__line">
          {dot}
          <span className="cal-card__title">{arg.event.title}</span>
        </span>
        {!arg.event.allDay && <span className="cal-card__time">{arg.timeText}</span>}
      </div>
    );
  }, []);

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
    grid.style.setProperty("--cal-strip-w", Math.round(gutter + w * STRIP_DAYS) + "px");
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
    });
    ro.observe(grid);
    return () => ro.disconnect();
  }, [firstVisibleDay, recomputeDayWidth]);

  // Recompute the day width when the zoom (target days) changes.
  useEffect(() => {
    recomputeDayWidth();
  }, [targetDays, recomputeDayWidth]);

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
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (sheet || popover || settingsOpen || hoursOpen) return;
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
  }, [changeView, goToday, nudge, sheet, popover, settingsOpen, hoursOpen]);

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
                    shadeWeekendsOn={shadeWeekends}
                    onToggleShadeWeekends={() => setShadeWeekends((on) => !on)}
                    weekStart={weekStart}
                    onWeekStart={setWeekStart}
                    onChangeView={changeView}
                    onOpenHours={() => setHoursOpen(true)}
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

      {hoursOpen && (
        <HoursPanel hours={campHours} onChange={setCampHours} onClose={() => setHoursOpen(false)} />
      )}

      {/* Mobile's home for the view settings (desktop puts them in the sidebar).
          One CalendarViewSettings, shared state — opening Camp hours / Manage
          camps dismisses this sheet first so the next modal isn't stacked behind. */}
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
              shadeWeekendsOn={shadeWeekends}
              onToggleShadeWeekends={() => setShadeWeekends((on) => !on)}
              weekStart={weekStart}
              onWeekStart={setWeekStart}
              onChangeView={changeView}
              onOpenHours={() => {
                setSettingsOpen(false);
                setHoursOpen(true);
              }}
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
