"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { fromDateKey, minutesOfDay, toDateKey, todayKey } from "@/lib/calendar/dates";
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
  snapMinutes,
} from "@/lib/calendar/time";
import type { CalendarEvent, DateKey } from "@/lib/calendar/types";
import type { Activity } from "@/lib/types";
import { useLocalStorage } from "@/lib/store";
import { CampIcon } from "../icons";
import { CalendarHeader, type CalendarViewId } from "./CalendarHeader";
import { EventEditor, draftFromEvent, type EditorDraft } from "./EventEditor";
import { EventPopover } from "./EventPopover";
import { LibraryPanel } from "./LibraryPanel";

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
}: {
  events: Record<string, CalendarEvent>;
  upsertEvent: (event: CalendarEvent) => void;
  removeEvent: (id: string) => void;
  activities: Activity[];
  byId: Record<string, Activity>;
  requireStaff: (action: string) => boolean;
  onOpenActivity: (activity: Activity, eventContext: CalendarEvent) => void;
  announce: (message: string) => void;
}) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [storedView, setStoredView] = useLocalStorage<CalendarViewId | "auto">(
    "calendarView",
    "auto",
    viewStorage
  );
  const [activeView, setActiveView] = useState<CalendarViewId>(
    storedView === "auto" ? "timeGridWeek" : storedView
  );
  const [title, setTitle] = useState("");
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const focusDateRef = useRef<DateKey>(todayKey());

  // Coarse pointers (phones) default to Day; everything else to Week.
  useEffect(() => {
    if (storedView !== "auto" || typeof window === "undefined") return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const resolved: CalendarViewId = coarse ? "timeGridDay" : "timeGridWeek";
    setActiveView(resolved);
    calendarRef.current?.getApi().changeView(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const healedEvents = useMemo(() => {
    const out: CalendarEvent[] = [];
    for (const event of Object.values(events)) out.push(healEvent(event, byId));
    return out;
  }, [events, byId]);

  const window_ = useMemo(() => effectiveWindow(healedEvents), [healedEvents]);

  const fcEvents = useMemo(() => healedEvents.map((event) => toFcEvent(event, byId)), [healedEvents, byId]);

  const scrollTime = useMemo(() => {
    const anchor = Math.max(window_.startMin, Math.min(nowMinutes() - 90, window_.endMin - 120));
    return minutesToTimeString(anchor);
  }, [window_]);

  const showToast = useCallback((next: ToastState) => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    },
    []
  );

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
    focusDateRef.current = now >= start && now < end ? toDateKey(now) : toDateKey(start);
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
      showToast({
        message: "Deleted " + (event.title || "event"),
        onUndo: () => upsertEvent({ ...event, updatedAt: Date.now() }),
      });
      announce("Deleted " + event.title);
    },
    [announce, removeEvent, requireStaff, showToast, upsertEvent]
  );

  // Tap-to-place: drop the activity at the next free slot on the focused day.
  const placeActivity = useCallback(
    (activity: Activity) => {
      if (!requireStaff("plan the calendar")) return;
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
      if (info.view.type === "dayGridMonth") return;
      if (!requireStaff("plan the calendar")) return;
      const startMin = minutesOfDay(info.start);
      const endMin = info.allDay
        ? startMin + DEFAULT_DURATION_MIN
        : Math.max(startMin + SNAP_MIN, Math.round((info.end.getTime() - fromDateKey(toDateKey(info.start)).getTime()) / 60_000));
      setEditor({
        date: toDateKey(info.start),
        startMin,
        durationMin: Math.min(MINUTES_PER_DAY - startMin, endMin - startMin),
        allDay: info.allDay,
        title: "",
      });
    },
    [requireStaff]
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
      setEditor({
        date: toDateKey(info.date),
        startMin,
        durationMin: DEFAULT_DURATION_MIN,
        allDay: info.allDay,
        title: "",
      });
    },
    [requireStaff, setStoredView]
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
      if (!start || !requireStaff("plan the calendar")) return;
      const date = toDateKey(start);
      const startMin = info.event.allDay ? 0 : snapMinutes(minutesOfDay(start), SNAP_MIN);
      const duration = Math.max(SNAP_MIN, activity?.durationMin ?? DEFAULT_DURATION_MIN);
      const event: CalendarEvent = {
        id: crypto.randomUUID(),
        date,
        startMin: info.event.allDay ? 0 : startMin,
        endMin: info.event.allDay ? 0 : Math.min(MINUTES_PER_DAY, startMin + duration),
        kind: activity ? "activity" : "custom",
        title: activity?.title ?? info.event.title ?? "Untitled",
        updatedAt: Date.now(),
      };
      if (activity) event.activityId = activity.id;
      if (info.event.allDay) event.allDay = true;
      upsertEvent(event);
      announce(event.title + " scheduled at " + (event.allDay ? "all day" : formatClock(event.startMin)));
    },
    [announce, byId, requireStaff, upsertEvent]
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

  // Keyboard shortcuts: t today, d/w/m views, arrows navigate.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (editor || popover) return;
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
  }, [changeView, editor, popover]);

  const popoverActivity = popover?.event.activityId ? byId[popover.event.activityId] ?? null : null;

  return (
    <div className="calshell">
      <CalendarHeader
        title={title}
        view={activeView}
        onView={changeView}
        onToday={() => calendarRef.current?.getApi().today()}
        onPrev={() => calendarRef.current?.getApi().prev()}
        onNext={() => calendarRef.current?.getApi().next()}
      />
      <div className="calshell__body">
        <div className="calshell__grid">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={activeView}
            headerToolbar={false}
            firstDay={1}
            height="100%"
            nowIndicator
            editable
            selectable
            selectMirror
            droppable
            dayMaxEvents={3}
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
        </div>
        <LibraryPanel variant="rail" activities={activities} onPlace={placeActivity} onPick={pickActivity} />
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
        <div className="cal-sheet-root">
          <button type="button" className="cal-sheet__scrim" aria-label="Close library" onClick={() => setSheetOpen(false)} />
          <LibraryPanel
            variant="sheet"
            activities={activities}
            onPlace={placeActivity}
            onPick={pickActivity}
            onClose={() => setSheetOpen(false)}
          />
        </div>
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
