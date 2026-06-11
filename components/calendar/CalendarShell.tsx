"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  formatClockCompact,
  minutesToTimeString,
  nextFreeStartForDay,
  nowMinutes,
  snapMinutes,
} from "@/lib/calendar/time";
import type { CalendarEvent, DateKey } from "@/lib/calendar/types";
import type { Activity } from "@/lib/types";
import { useLocalStorage } from "@/lib/store";
import { CampIcon } from "../icons";
import { Modal } from "../Modal";
import { CalendarHeader, type CalendarViewId } from "./CalendarHeader";
import { EventEditor, draftFromEvent, type EditorDraft } from "./EventEditor";
import { EventPopover } from "./EventPopover";
import { LibraryPanel } from "./LibraryPanel";
import { QuickAdd } from "./QuickAdd";

const VIEW_IDS = new Set<string>(["timeGridDay", "timeGridWeek", "dayGridMonth"]);

type PopoverState = { event: CalendarEvent; anchor: DOMRect };
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
  requireStaff,
  onOpenActivity,
  announce,
  railSlot,
}: {
  events: Record<string, CalendarEvent>;
  upsertEvent: (event: CalendarEvent) => void;
  removeEvent: (id: string) => void;
  activities: Activity[];
  byId: Record<string, Activity>;
  requireStaff: (action: string) => boolean;
  onOpenActivity: (activity: Activity, eventContext: CalendarEvent) => void;
  announce: (message: string) => void;
  /** Desktop: the left-sidebar slot the activity library renders into (one
   *  sidebar shared with the Library tab's filters). Null on mobile. */
  railSlot?: HTMLElement | null;
}) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [storedView, setStoredView] = useLocalStorage<CalendarViewId | "auto">(
    "calendarView",
    "auto",
    viewStorage
  );
  // The initial view resolves client-side (coarse pointer → Day); the grid
  // mounts only after resolution so phones never flash Week first.
  const [resolvedView, setResolvedView] = useState<CalendarViewId | null>(null);
  const [activeView, setActiveView] = useState<CalendarViewId>("timeGridWeek");
  const [title, setTitle] = useState("");
  const [todayInView, setTodayInView] = useState(true);
  const [visibleRange, setVisibleRange] = useState<{ start: DateKey; end: DateKey } | null>(null);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [quickAdd, setQuickAdd] = useState<EditorDraft | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // While a create gesture is live (dragging a library row over the grid, or
  // drag-selecting a span) the empty-state invitation clears out of the way.
  const [isCreating, setIsCreating] = useState(false);
  const creatingRef = useRef(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const focusDateRef = useRef<DateKey>(todayKey());
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | null>(null);
  const swipeRef = useRef<{ x: number; y: number; at: number; onEvent: boolean } | null>(null);

  // Coarse pointers (phones) default to Day; everything else to Week.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (storedView !== "auto") {
      setResolvedView(storedView);
      setActiveView(storedView);
      return;
    }
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const resolved: CalendarViewId = coarse ? "timeGridDay" : "timeGridWeek";
    setResolvedView(resolved);
    setActiveView(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const healedEvents = useMemo(() => {
    const out: CalendarEvent[] = [];
    for (const event of Object.values(events)) out.push(healEvent(event, byId));
    return out;
  }, [events, byId]);

  // The day window auto-extends only around events in the VISIBLE range — a
  // stray 6am event last month shouldn't stretch every day's grid forever.
  const window_ = useMemo(() => {
    const scoped = visibleRange
      ? healedEvents.filter((event) => event.date >= visibleRange.start && event.date < visibleRange.end)
      : healedEvents;
    return effectiveWindow(scoped);
  }, [healedEvents, visibleRange]);

  const fcEvents = useMemo(() => healedEvents.map((event) => toFcEvent(event, byId)), [healedEvents, byId]);

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

  const beginCreating = useCallback(() => {
    if (!creatingRef.current) {
      creatingRef.current = true;
      setIsCreating(true);
    }
  }, []);
  const endCreating = useCallback(() => {
    if (creatingRef.current) {
      creatingRef.current = false;
      setIsCreating(false);
    }
  }, []);
  // Any pointer release ends a create gesture (a drop, a finished drag-select,
  // or an aborted drag) — the empty state returns if nothing landed.
  useEffect(() => {
    window.addEventListener("pointerup", endCreating);
    window.addEventListener("pointercancel", endCreating);
    return () => {
      window.removeEventListener("pointerup", endCreating);
      window.removeEventListener("pointercancel", endCreating);
    };
  }, [endCreating]);

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
      const endMin = Math.min(MINUTES_PER_DAY, draft.startMin + draft.durationMin);
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
      setEditor(null);
      announce((draft.id ? "Updated " : "Added ") + event.title);
    },
    [announce, byId, requireStaff, upsertEvent]
  );

  const deleteEvent = useCallback(
    (event: CalendarEvent) => {
      if (!requireStaff("change the calendar")) return;
      removeEvent(event.id);
      setPopover(null);
      setEditor(null);
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

  // Tap-to-place: drop the activity at the next free slot on the focused day.
  const placeActivity = useCallback(
    (activity: Activity) => {
      if (!requireStaff("plan the calendar")) return;
      setSheetOpen(false); // reveal the calendar so the placement (and toast) is visible
      const dateKey = focusDateRef.current;
      const dayEvents = healedEvents.filter((event) => event.date === dateKey);
      const notBefore =
        dateKey === todayKey() ? Math.max(nowMinutes(), DEFAULT_PLANNING_START_MIN) : DEFAULT_PLANNING_START_MIN;
      const start = nextFreeStartForDay(dayEvents, activity.durationMin, notBefore, window_);
      if (start == null) {
        announce("No open time for " + activity.title);
        showToast({ message: "No open time for " + activity.title });
        return;
      }
      const event: CalendarEvent = {
        id: crypto.randomUUID(),
        date: dateKey,
        startMin: start,
        endMin: Math.min(MINUTES_PER_DAY, start + Math.max(SNAP_MIN, activity.durationMin)),
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

  const pickActivity = useCallback((activity: Activity) => {
    setSheetOpen(false);
    setEditor({
      date: focusDateRef.current,
      startMin: DEFAULT_PLANNING_START_MIN,
      durationMin: activity.durationMin || DEFAULT_DURATION_MIN,
      allDay: false,
      activityId: activity.id,
      title: activity.title,
    });
  }, []);

  // --- FullCalendar callbacks -------------------------------------------

  const onSelect = useCallback(
    (info: DateSelectArg) => {
      calendarRef.current?.getApi().unselect();
      endCreating();
      if (info.view.type === "dayGridMonth") {
        // Month cells are whole days — picking a time needs a time grid.
        showToast({ message: "To pick a time, switch to Day or Week — or tap a day to open it" });
        return;
      }
      if (!requireStaff("plan the calendar")) return;
      const startMin = minutesOfDay(info.start);
      const endMin = info.allDay
        ? startMin + DEFAULT_DURATION_MIN
        : Math.max(startMin + SNAP_MIN, Math.round((info.end.getTime() - fromDateKey(toDateKey(info.start)).getTime()) / 60_000));
      // A drag-select is always a deliberate span — its length must win over any
      // activity's recommended duration once an activity is chosen.
      setQuickAdd({
        date: toDateKey(info.start),
        startMin,
        durationMin: Math.min(MINUTES_PER_DAY - startMin, endMin - startMin),
        allDay: info.allDay,
        title: "",
        explicitDuration: !info.allDay,
      });
    },
    [endCreating, requireStaff, showToast]
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
      setQuickAdd({
        date: toDateKey(info.date),
        startMin,
        durationMin: DEFAULT_DURATION_MIN,
        allDay: info.allDay,
        title: "",
        explicitDuration: false,
      });
    },
    [requireStaff, setStoredView]
  );

  // QuickAdd: a picked activity (or a custom title) creates immediately, with
  // Undo. The dragged span wins; otherwise the activity's recommended length.
  const quickAddActivity = useCallback(
    (activity: Activity) => {
      const draft = quickAdd;
      if (!draft || !requireStaff("plan the calendar")) return;
      const duration = draft.explicitDuration
        ? Math.max(SNAP_MIN, draft.durationMin)
        : Math.max(SNAP_MIN, activity.durationMin || draft.durationMin);
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
      setQuickAdd(null);
      announce("Added " + event.title);
      showToast({
        message: "Added " + activity.title + (event.allDay ? " · all day" : " · " + formatClock(startMin)),
        onUndo: () => removeEvent(event.id),
      });
    },
    [announce, quickAdd, removeEvent, requireStaff, showToast, upsertEvent]
  );

  const quickAddCustom = useCallback(
    (title: string) => {
      const draft = quickAdd;
      if (!draft || !requireStaff("plan the calendar")) return;
      const startMin = draft.allDay ? 0 : draft.startMin;
      const event: CalendarEvent = {
        id: crypto.randomUUID(),
        date: draft.date,
        startMin,
        endMin: draft.allDay ? 0 : Math.min(MINUTES_PER_DAY, startMin + Math.max(SNAP_MIN, draft.durationMin)),
        kind: "custom",
        title,
        updatedAt: Date.now(),
      };
      if (draft.allDay) event.allDay = true;
      upsertEvent(event);
      setQuickAdd(null);
      announce("Added " + title);
      showToast({
        message: "Added " + title + (event.allDay ? " · all day" : " · " + formatClock(startMin)),
        onUndo: () => removeEvent(event.id),
      });
    },
    [announce, quickAdd, removeEvent, requireStaff, showToast, upsertEvent]
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
      setSheetOpen(false); // reveal the calendar so the drop (and toast) is visible
      if (!start || !requireStaff("plan the calendar")) return;
      const date = toDateKey(start);
      const duration = Math.max(SNAP_MIN, activity?.durationMin ?? DEFAULT_DURATION_MIN);

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
  }, []);

  const renderEventContent = useCallback((arg: EventContentArg) => {
    if (arg.view.type === "dayGridMonth") {
      return (
        <div className="cal-chip">
          <span className="cal-chip__dot" aria-hidden="true" />
          {!arg.event.allDay && <span className="cal-chip__time">{arg.timeText}</span>}
          <span className="cal-chip__title">{arg.event.title}</span>
        </div>
      );
    }
    // Short events get Google's one-line treatment ("Capture the Flag · 10a")
    // instead of clipping a stacked title + range.
    const calendarEvent = arg.event.extendedProps.calendarEvent as CalendarEvent | undefined;
    const durationMin =
      calendarEvent && !calendarEvent.allDay ? calendarEvent.endMin - calendarEvent.startMin : null;
    if (durationMin != null && durationMin <= 30) {
      return (
        <div className="cal-card cal-card--compact">
          <span className="cal-card__title">{arg.event.title}</span>
          <span className="cal-card__time">{formatClockCompact(calendarEvent!.startMin)}</span>
        </div>
      );
    }
    return (
      <div className="cal-card">
        <span className="cal-card__title">{arg.event.title}</span>
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
      if (editor || popover || sheetOpen) return;
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
  }, [changeView, editor, popover, sheetOpen]);

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
      />
      <div className="calshell__body">
        <div
          className={"calshell__grid" + (swipeDir ? " is-swipe-" + swipeDir : "")}
          onTouchStart={onGridTouchStart}
          onTouchEnd={onGridTouchEnd}
        >
          {healedEvents.length === 0 && !isCreating && !sheetOpen && (
            <div className="calshell__empty" aria-hidden="true">
              <span className="calshell__empty-title">Nothing planned yet</span>
              <span className="calshell__empty-hint">
                Pull an activity in from the library — or tap an empty slot to start.
              </span>
            </div>
          )}
          {resolvedView && (
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={resolvedView}
            headerToolbar={false}
            firstDay={1}
            height="100%"
            nowIndicator
            editable
            selectable
            selectMirror
            selectMinDistance={8}
            droppable
            selectAllow={() => {
              // Fires throughout a drag-select; the side effect clears the empty state.
              beginCreating();
              return true;
            }}
            dayMaxEvents={3}
            slotEventOverlap={false}
            eventShortHeight={46}
            eventMinHeight={22}
            snapDuration="00:15:00"
            slotDuration="00:30:00"
            slotMinTime={minutesToTimeString(window_.startMin)}
            slotMaxTime={minutesToTimeString(window_.endMin)}
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
            eventDrop={onEventDrop}
            eventResize={onEventResize}
            eventReceive={onEventReceive}
            eventDidMount={onEventDidMount}
            eventContent={renderEventContent}
            dayHeaderContent={renderDayHeader}
            events={fcEvents}
          />
          )}
        </div>
        {/* The activity library lives in the left sidebar (rendered into a slot
            CampApp owns), so there's one sidebar and the grid spans full width.
            It stays a child of CalendarShell so all the place/pick/drag wiring
            is unchanged. Null slot (mobile) → the FAB + sheet below take over. */}
        {railSlot &&
          createPortal(
            <LibraryPanel
              variant="rail"
              activities={activities}
              onPlace={placeActivity}
              onPick={pickActivity}
              onDragStart={beginCreating}
              onDragStop={endCreating}
            />,
            railSlot
          )}
      </div>

      <button
        type="button"
        className="calshell__fab"
        onClick={() => setSheetOpen(true)}
        aria-label="Add from the library"
        title="Add from the library"
      >
        <CampIcon.Plus />
      </button>

      {sheetOpen && (
        <Modal
          label="Add from the library"
          onClose={() => setSheetOpen(false)}
          overlayProps={{ className: "overlay--picker" }}
        >
          <LibraryPanel
            variant="sheet"
            activities={activities}
            onPlace={placeActivity}
            onPick={pickActivity}
            onClose={() => setSheetOpen(false)}
          />
        </Modal>
      )}

      {quickAdd && (
        <QuickAdd
          draft={quickAdd}
          activities={activities}
          onPickActivity={quickAddActivity}
          onCustom={quickAddCustom}
          onMore={() => {
            setEditor(quickAdd);
            setQuickAdd(null);
          }}
          onClose={() => setQuickAdd(null)}
        />
      )}

      {editor && (
        <EventEditor
          initial={editor}
          activities={activities}
          window={window_}
          onSave={saveDraft}
          onDelete={
            editor.id
              ? () => {
                  const existing = events[editor.id as string];
                  if (existing) deleteEvent(existing);
                }
              : undefined
          }
          onClose={() => setEditor(null)}
        />
      )}

      {popover && (
        <EventPopover
          event={popover.event}
          activity={popoverActivity}
          anchor={popover.anchor}
          onOpenActivity={(activity) => {
            setPopover(null);
            onOpenActivity(activity, popover.event);
          }}
          onEdit={() => {
            setEditor(draftFromEvent(popover.event));
            setPopover(null);
          }}
          onDelete={() => deleteEvent(popover.event)}
          onClose={() => setPopover(null)}
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
