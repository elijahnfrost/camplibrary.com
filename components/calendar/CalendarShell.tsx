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
import { formatEventDateLabel, fromDateKey, minutesOfDay, toDateKey, todayKey } from "@/lib/calendar/dates";
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
import type { Theme } from "@/lib/themes";
import type { Activity } from "@/lib/types";
import { useLocalStorage } from "@/lib/store";
import { CampIcon } from "../icons";
import { ContextMenu } from "../floating/ContextMenu";
import { CalendarHeader, type CalendarViewId } from "./CalendarHeader";
import { EventPopover } from "./EventPopover";
import { HoursPanel } from "./HoursPanel";
import { LibraryPanel } from "./LibraryPanel";
import { QuickAdd, draftFromEvent, type EditorDraft } from "./QuickAdd";

const VIEW_IDS = new Set<string>(["timeGridDay", "timeGridWeek", "dayGridMonth"]);

type PopoverState = { event: CalendarEvent; anchor: DOMRect };
type MenuState = { event: CalendarEvent; point: { x: number; y: number } };
type ToastState = { message: string; onUndo?: () => void };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const viewStorage = (value: unknown, fallback: CalendarViewId | "auto") =>
  value === "timeGridDay" || value === "timeGridWeek" || value === "dayGridMonth"
    ? value
    : fallback;

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
  headerActions,
  themes,
  themeAssignments,
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
  /** Desktop: the left-sidebar slot the activity library renders into (one
   *  sidebar shared with the Library tab's filters). Null on mobile. */
  railSlot?: HTMLElement | null;
  /** Rendered at the right end of the calendar header (e.g. the auth pill). */
  headerActions?: ReactNode;
  /** Theme vocabulary + assignment map + resolver, for the rail filter and the
   *  per-event theme badge (events reflect their activity's theme). */
  themes: Theme[];
  themeAssignments: Record<string, string>;
  themeOf: ThemeResolver;
}) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [storedView, setStoredView] = useLocalStorage<CalendarViewId | "auto">(
    "calendarView",
    "auto",
    viewStorage
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
  // The initial view resolves client-side (coarse pointer → Day); the grid
  // mounts only after resolution so phones never flash Week first.
  const [resolvedView, setResolvedView] = useState<CalendarViewId | null>(null);
  const [activeView, setActiveView] = useState<CalendarViewId>("timeGridWeek");
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
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | null>(null);
  const swipeRef = useRef<{ x: number; y: number; at: number; onEvent: boolean } | null>(null);

  // Coarse pointers (phones) default to Day; everything else to Week.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let resolved: CalendarViewId;
    if (storedView !== "auto") {
      resolved = storedView;
    } else {
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      resolved = coarse ? "timeGridDay" : "timeGridWeek";
    }
    // The 7-column Week grid is unreadable under the wide-phone breakpoint
    // (--bp-wide-phone 640) — coerce it to Day there regardless of the stored
    // preference. Day and Month stay as chosen; Week is simply never forced onto
    // a phone-width screen.
    if (resolved === "timeGridWeek" && window.matchMedia("(max-width: 639px)").matches) {
      resolved = "timeGridDay";
    }
    setResolvedView(resolved);
    setActiveView(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const healedEvents = useMemo(() => {
    const out: CalendarEvent[] = [];
    for (const event of Object.values(events)) out.push(healEvent(event, byId));
    return out;
  }, [events, byId]);

  // The base window comes from the configured camp hours (union of the enabled
  // camps' drop-off → pickup); auto-extend only ever stretches it outward.
  const campWindow = useMemo(() => windowFromCampHours(campHours), [campHours]);

  // The day window auto-extends only around events in the VISIBLE range — a
  // stray 6am event last month shouldn't stretch every day's grid forever.
  const window_ = useMemo(() => {
    const scoped = visibleRange
      ? healedEvents.filter((event) => event.date >= visibleRange.start && event.date < visibleRange.end)
      : healedEvents;
    return effectiveWindow(scoped, campWindow);
  }, [healedEvents, visibleRange, campWindow]);

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

  const changeView = useCallback(
    (view: CalendarViewId) => {
      setActiveView(view);
      setStoredView(view);
      calendarRef.current?.getApi().changeView(view);
    },
    [setStoredView]
  );

  const onDatesSet = useCallback((arg: DatesSetArg) => {
    setTitle(arg.view.title);
    // Navigation/view changes re-render the grid, so a cursor-anchored menu or
    // a rect-anchored popover would detach — dismiss them.
    setMenu(null);
    setPopover(null);
    if (VIEW_IDS.has(arg.view.type)) setActiveView(arg.view.type as CalendarViewId);
    // Track the day tap-to-place targets: today when visible, else range start.
    const start = arg.view.currentStart;
    const end = arg.view.currentEnd;
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

  // Tap-to-place: drop the activity at the next free slot on the focused day.
  const placeActivity = useCallback(
    (activity: Activity) => {
      if (!requireStaff("plan the calendar")) return;
      const dateKey = focusDateRef.current;
      const dayEvents = healedEvents.filter((event) => event.date === dateKey);
      const notBefore =
        dateKey === todayKey() ? Math.max(nowMinutes(), DEFAULT_PLANNING_START_MIN) : DEFAULT_PLANNING_START_MIN;
      const duration = snapDurationMin(activity.durationMin);
      const start = nextFreeStartForDay(dayEvents, duration, notBefore, window_);
      if (start == null) {
        announce("No open time for " + activity.title);
        showToast({ message: "No open time for " + activity.title });
        return;
      }
      const event: CalendarEvent = {
        id: crypto.randomUUID(),
        date: dateKey,
        startMin: start,
        endMin: Math.min(MINUTES_PER_DAY, start + duration),
        kind: "activity",
        title: activity.title,
        activityId: activity.id,
        updatedAt: Date.now(),
      };
      upsertEvent(event);
      announce(activity.title + " added at " + formatClock(start));
      showToast({
        message: "Added " + activity.title + " · " + formatClock(start),
        onUndo: () => removeEvent(event.id),
      });
    },
    [announce, healedEvents, removeEvent, requireStaff, showToast, upsertEvent, window_]
  );

  // "Pick a time": the same event window, with the when-row showing and the
  // chosen activity preselected.
  const pickActivity = useCallback(
    (activity: Activity) => {
      if (!requireStaff("plan the calendar")) return;
      setSheet({
        draft: {
          date: focusDateRef.current,
          startMin: DEFAULT_PLANNING_START_MIN,
          durationMin: snapDurationMin(activity.durationMin || DEFAULT_DURATION_MIN),
          allDay: false,
          activityId: activity.id,
          title: activity.title,
        },
        pickTime: true,
      });
    },
    [requireStaff]
  );

  // The mobile + button: same window, nothing prechosen.
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
      return <span className="cal-dayhead__dow">{weekday}</span>;
    }
    return (
      <div className={"cal-dayhead" + (arg.isToday ? " is-today" : "")}>
        <span className="cal-dayhead__dow">{weekday}</span>
        <span className="cal-dayhead__num">{arg.date.getDate()}</span>
      </div>
    );
  }, []);

  // Swipe between days/weeks like the Google Calendar app: a quick,
  // mostly-horizontal swipe on the grid background navigates prev/next.
  // Touches that start on an event are ignored (long-press drag owns those),
  // and the 2:1 horizontal-intent threshold keeps vertical scrolling free.
  const onGridTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      swipeRef.current = null;
      return;
    }
    const touch = event.touches[0];
    const onEvent = Boolean((event.target as HTMLElement).closest(".fc-event"));
    swipeRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now(), onEvent };
  }, []);

  const onGridTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.onEvent || event.changedTouches.length !== 1) return;
    if (Date.now() - start.at > 600) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2) return;
    const api = calendarRef.current?.getApi();
    if (!api || api.view.type === "dayGridMonth") return;
    setSwipeDir(dx < 0 ? "left" : "right");
    if (dx < 0) api.next();
    else api.prev();
    window.setTimeout(() => setSwipeDir(null), 240);
  }, []);

  // Keyboard shortcuts: t today, d/w/m views, arrows navigate.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (sheet || popover) return;
      const api = calendarRef.current?.getApi();
      if (!api) return;
      switch (event.key) {
        case "t":
          api.today();
          break;
        case "d":
          changeView("timeGridDay");
          break;
        case "w":
          changeView("timeGridWeek");
          break;
        case "m":
          changeView("dayGridMonth");
          break;
        case "ArrowLeft":
          api.prev();
          break;
        case "ArrowRight":
          api.next();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeView, sheet, popover]);

  const popoverActivity = popover?.event.activityId ? byId[popover.event.activityId] ?? null : null;

  return (
    <div className="calshell">
      <CalendarHeader
        title={title}
        view={activeView}
        todayInView={todayInView}
        onView={changeView}
        onToday={() => calendarRef.current?.getApi().today()}
        onPrev={() => calendarRef.current?.getApi().prev()}
        onNext={() => calendarRef.current?.getApi().next()}
        actions={
          <>
            <button
              type="button"
              className="btn btn--quiet calhead__hours"
              onClick={() => setHoursOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={hoursOpen}
              title="Set the camp hours the calendar shows"
            >
              <CampIcon.Clock />
              <span className="calhead__hours-label">Hours</span>
            </button>
            {headerActions}
          </>
        }
      />
      <div className="calshell__body">
        <div
          className={"calshell__grid" + (swipeDir ? " is-swipe-" + swipeDir : "")}
          onTouchStart={onGridTouchStart}
          onTouchEnd={onGridTouchEnd}
          onContextMenu={onGridContextMenu}
        >
          {resolvedView && (
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={resolvedView}
            headerToolbar={false}
            firstDay={1}
            height="100%"
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
          )}
          {/* The free-following "card in hand" during a drag: a full-opacity
              clone of the event that tracks the raw cursor (the snapped dotted
              box is FullCalendar's own mirror). Positioned in JS by
              traceFollower; aria-hidden — purely a visual drag preview. */}
          <div ref={followRef} className="cal-dragfollow fc-event" aria-hidden="true" />
        </div>
        {/* The activity library lives in the left sidebar (rendered into a slot
            CampApp owns), so there's one sidebar and the grid spans full width.
            It stays a child of CalendarShell so all the place/pick/drag wiring
            is unchanged. Null slot (mobile) → the FAB + sheet below take over. */}
        {railSlot &&
          createPortal(
            <LibraryPanel
              activities={activities}
              onPlace={placeActivity}
              onPick={pickActivity}
              themes={themes}
              themeAssignments={themeAssignments}
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
