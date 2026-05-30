"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Activity, DaySchedule, SavedDayPlan, ScheduleBlock } from "@/lib/types";
import { code, DAYS, durLabel, ENERGY } from "@/lib/data";
import {
  blockEndMin,
  blockStartMin,
  campMinutes,
  clampStart,
  DAY_END_MIN,
  DAY_START_MIN,
  DEFAULT_DURATION_MIN,
  DURATION_OPTIONS,
  formatRange,
  hourMarks,
  MIN_DURATION_MIN,
  minutesToCamp,
  nextFreeStart,
  snapMinutes,
  startOptions,
  TOTAL_MIN,
} from "@/lib/scheduleTime";
import { CampIcon } from "./icons";
import { Filters, type AgeFilter, type CatFilter, type PlaceFilter } from "./Filters";
import { StarButton } from "./primitives";

export type EventDraft = {
  kind: "activity" | "label";
  activityId?: string;
  label: string;
  start: string;
  end: string;
};

function activityMeta(activity: Activity): string {
  return code(activity) + " · " + durLabel(activity) + " · " + ENERGY[activity.energy];
}

function pct(min: number): number {
  return ((min - DAY_START_MIN) / TOTAL_MIN) * 100;
}

// ---- Overlap layout: assign side-by-side columns to events that share time ----

type Laid = {
  startMin: number;
  endMin: number;
  block: ScheduleBlock | null;
  ghost?: boolean;
  dragging?: boolean;
  col: number;
  cols: number;
};

function layoutEvents(items: Omit<Laid, "col" | "cols">[]): Laid[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Laid[] = [];
  let group: Laid[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    const colEnds: number[] = [];
    for (const item of group) {
      let placed = false;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= item.startMin) {
          item.col = c;
          colEnds[c] = item.endMin;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item.col = colEnds.length;
        colEnds.push(item.endMin);
      }
    }
    group.forEach((item) => (item.cols = colEnds.length));
    out.push(...group);
    group = [];
  };

  for (const raw of sorted) {
    const item: Laid = { ...raw, col: 0, cols: 1 };
    if (group.length && item.startMin >= groupEnd) {
      flush();
      groupEnd = -Infinity;
    }
    group.push(item);
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  if (group.length) flush();
  return out;
}

// ============================================================
// Add / edit event composer
// ============================================================

function EventComposer({
  dayName,
  allActivities,
  initial,
  onSubmit,
  onClose,
}: {
  dayName: string;
  allActivities: Activity[];
  initial: {
    blockId?: string;
    tab: "library" | "custom";
    activityId?: string;
    label: string;
    start: string;
    durationMin: number;
  };
  onSubmit: (draft: EventDraft, blockId?: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"library" | "custom">(initial.tab);
  const [search, setSearch] = useState("");
  const [activityId, setActivityId] = useState<string | undefined>(initial.activityId);
  const [label, setLabel] = useState(initial.label);
  const [start, setStart] = useState(initial.start);
  const [durationMin, setDurationMin] = useState(initial.durationMin);

  const isEdit = Boolean(initial.blockId);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allActivities;
    return allActivities.filter((a) =>
      (a.title + " " + a.type + " " + a.blurb).toLowerCase().includes(q)
    );
  }, [allActivities, search]);

  const durationChoices = useMemo(() => {
    const set = new Set<number>(DURATION_OPTIONS);
    set.add(durationMin);
    return [...set].sort((a, b) => a - b);
  }, [durationMin]);

  function chooseActivity(activity: Activity) {
    setActivityId(activity.id);
    setDurationMin(Math.max(MIN_DURATION_MIN, activity.durationMin));
  }

  const canSubmit =
    tab === "library" ? Boolean(activityId) : label.trim().length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const startMinutes = campMinutes(start);
    const endMinutes = Math.min(DAY_END_MIN, startMinutes + durationMin);
    if (tab === "library") {
      const activity = allActivities.find((a) => a.id === activityId);
      onSubmit(
        {
          kind: "activity",
          activityId,
          label: activity ? activity.title : "Activity",
          start: minutesToCamp(startMinutes),
          end: minutesToCamp(endMinutes),
        },
        initial.blockId
      );
    } else {
      onSubmit(
        {
          kind: "label",
          label: label.trim(),
          start: minutesToCamp(startMinutes),
          end: minutesToCamp(endMinutes),
        },
        initial.blockId
      );
    }
  }

  return (
    <div className="composer-scrim" role="dialog" aria-modal="true" aria-label={(isEdit ? "Edit" : "Add") + " event"}>
      <div className="composer-backdrop" onClick={onClose} />
      <form className="composer fadein" onSubmit={submit}>
        <header className="composer__head">
          <div>
            <span className="composer__kicker">{isEdit ? "Edit event" : "Add to " + dayName}</span>
            <h2 className="composer__title">{isEdit ? "Edit event" : "New event"}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </header>

        <div className="composer__seg" role="tablist" aria-label="Event type">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "library"}
            className={tab === "library" ? "is-on" : ""}
            onClick={() => setTab("library")}
          >
            From library
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "custom"}
            className={tab === "custom" ? "is-on" : ""}
            onClick={() => setTab("custom")}
          >
            Custom
          </button>
        </div>

        {tab === "library" ? (
          <div className="composer__library">
            <label className="schedule-search composer__search">
              <CampIcon.Search />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search activities…"
                aria-label="Search activities"
                autoFocus
              />
            </label>
            <div className="composer__list" role="listbox" aria-label="Activities">
              {matches.length ? (
                matches.map((activity) => (
                  <button
                    type="button"
                    key={activity.id}
                    role="option"
                    aria-selected={activityId === activity.id}
                    className={"composer__option" + (activityId === activity.id ? " is-on" : "")}
                    onClick={() => chooseActivity(activity)}
                  >
                    <span className="composer__option-title">{activity.title}</span>
                    <span className="composer__option-meta">{activityMeta(activity)}</span>
                  </button>
                ))
              ) : (
                <div className="composer__empty">No activities match “{search}”.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="field composer__custom">
            <label className="field__label" htmlFor="composer-label">
              Label
            </label>
            <input
              id="composer-label"
              className="input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Lunch, free swim, rest hour…"
              autoFocus
            />
          </div>
        )}

        <div className="composer__times">
          <div className="field">
            <label className="field__label" htmlFor="composer-start">
              Starts
            </label>
            <select
              id="composer-start"
              className="input"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            >
              {startOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="composer-duration">
              Length
            </label>
            <select
              id="composer-duration"
              className="input"
              value={durationMin}
              onChange={(event) => setDurationMin(parseInt(event.target.value, 10))}
            >
              {durationChoices.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} min
                </option>
              ))}
            </select>
          </div>
        </div>

        <footer className="composer__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
            <CampIcon.Check />
            {isEdit ? "Save event" : "Add event"}
          </button>
        </footer>
      </form>
    </div>
  );
}

// ============================================================
// Activity library (desktop side panel / mobile tray)
// ============================================================

function ScheduleLibrary({
  isOpen,
  activities,
  query,
  onQueryChange,
  cat,
  place,
  age,
  onCat,
  onPlace,
  onAge,
  plans,
  dayName,
  onToggle,
  onOpenActivity,
  onQuickAdd,
  onStartDrag,
  onSavePlan,
  onApplyPlan,
  onDeletePlan,
  isFav,
  onToggleFav,
}: {
  isOpen: boolean;
  activities: Activity[];
  query: string;
  onQueryChange: (value: string) => void;
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  onCat: (value: CatFilter) => void;
  onPlace: (value: PlaceFilter) => void;
  onAge: (value: AgeFilter) => void;
  plans: SavedDayPlan[];
  dayName: string;
  onToggle: () => void;
  onOpenActivity: (activity: Activity) => void;
  onQuickAdd: (activityId: string) => void;
  onStartDrag: (event: ReactPointerEvent, activity: Activity) => void;
  onSavePlan: (name: string) => void;
  onApplyPlan: (planId: string) => void;
  onDeletePlan: (planId: string) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
}) {
  const [planName, setPlanName] = useState("");

  function submitPlan(event: FormEvent) {
    event.preventDefault();
    onSavePlan(planName || dayName + " plan");
    setPlanName("");
  }

  return (
    <aside className={"schedule-library" + (isOpen ? " is-open" : "")} aria-label="Activity library">
      <button type="button" className="schedule-library__toggle" onClick={onToggle} aria-expanded={isOpen}>
        <span>Activity library</span>
        <strong>{activities.length} matches</strong>
        <CampIcon.ChevronUp />
      </button>

      <div className="schedule-library__content">
        <label className="schedule-search">
          <CampIcon.Search />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Find an activity…"
            aria-label="Search activities"
          />
        </label>

        <Filters variant="bar" cat={cat} place={place} age={age} onCat={onCat} onPlace={onPlace} onAge={onAge} />

        <p className="schedule-library__hint">Drag onto the calendar, or tap + to drop it at the next open time.</p>

        <div className="schedule-activity-list" aria-label="Activities">
          {activities.length ? (
            activities.map((activity) => (
              <div className="schedule-activity" key={activity.id}>
                <span
                  className="schedule-activity__grip"
                  aria-hidden="true"
                  onPointerDown={(event) => onStartDrag(event, activity)}
                  title="Drag onto the calendar"
                >
                  <CampIcon.Grip />
                </span>
                <button type="button" className="schedule-activity__main" onClick={() => onOpenActivity(activity)}>
                  <span className="schedule-activity__title">{activity.title}</span>
                  <span className="schedule-activity__meta">{activityMeta(activity)}</span>
                </button>
                <StarButton on={isFav(activity.id)} onToggle={() => onToggleFav(activity.id)} />
                <button
                  type="button"
                  className="schedule-activity__add"
                  onClick={() => onQuickAdd(activity.id)}
                  aria-label={"Add " + activity.title + " to " + dayName}
                >
                  <CampIcon.Plus />
                </button>
              </div>
            ))
          ) : (
            <div className="schedule-library__empty">No activities match these filters.</div>
          )}
        </div>

        <section className="saved-plans" aria-label="Saved plans">
          <div className="saved-plans__head">Saved day plans</div>
          <form className="saved-plans__save" onSubmit={submitPlan}>
            <input
              value={planName}
              onChange={(event) => setPlanName(event.target.value)}
              placeholder={dayName + " plan"}
              aria-label="Plan name"
            />
            <button type="submit" className="btn btn--quiet">
              <CampIcon.Bookmark />
              Save
            </button>
          </form>
          <div className="saved-plans__chips">
            {plans.length ? (
              plans.map((plan) => (
                <span className="plan-chip" key={plan.id}>
                  <button type="button" className="plan-chip__apply" onClick={() => onApplyPlan(plan.id)}>
                    {plan.name}
                  </button>
                  <button
                    type="button"
                    className="plan-chip__delete"
                    onClick={() => onDeletePlan(plan.id)}
                    aria-label={"Delete " + plan.name}
                  >
                    <CampIcon.Close />
                  </button>
                </span>
              ))
            ) : (
              <span className="saved-plans__none">No saved plans yet.</span>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

// ============================================================
// Drag state
// ============================================================

type DragState =
  | {
      type: "move";
      blockId: string;
      grabOffsetMin: number;
      durationMin: number;
      startMin: number;
      endMin: number;
      moved: boolean;
    }
  | { type: "resize"; blockId: string; startMin: number; endMin: number }
  | {
      type: "create";
      activity: Activity;
      durationMin: number;
      startMin: number;
      endMin: number;
      clientX: number;
      clientY: number;
      over: boolean;
    };

// ============================================================
// Schedule view
// ============================================================

export function ScheduleView({
  dayIndex,
  onDayChange,
  blocks,
  weekBlocks,
  activities,
  allActivities,
  query,
  onQueryChange,
  cat,
  place,
  age,
  onCat,
  onPlace,
  onAge,
  plans,
  onAddEvent,
  onUpdateEvent,
  onRemoveEvent,
  onQuickAdd,
  onSavePlan,
  onApplyPlan,
  onDeletePlan,
  onOpenActivity,
  isFav,
  onToggleFav,
  byId,
}: {
  dayIndex: number;
  onDayChange: (d: number) => void;
  blocks: DaySchedule;
  weekBlocks: Record<number, DaySchedule>;
  activities: Activity[];
  allActivities: Activity[];
  query: string;
  onQueryChange: (value: string) => void;
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  onCat: (value: CatFilter) => void;
  onPlace: (value: PlaceFilter) => void;
  onAge: (value: AgeFilter) => void;
  plans: SavedDayPlan[];
  onAddEvent: (draft: EventDraft) => void;
  onUpdateEvent: (blockId: string, patch: Partial<ScheduleBlock>) => void;
  onRemoveEvent: (blockId: string) => void;
  onQuickAdd: (activityId: string) => void;
  onSavePlan: (name: string) => void;
  onApplyPlan: (planId: string) => void;
  onDeletePlan: (planId: string) => void;
  onOpenActivity: (activity: Activity) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  byId: Record<string, Activity>;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [composer, setComposer] = useState<{
    blockId?: string;
    tab: "library" | "custom";
    activityId?: string;
    label: string;
    start: string;
    durationMin: number;
  } | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const calScrollRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDragInternal] = useState<DragState | null>(null);
  const suppressClickRef = useRef(false);

  // Keep the latest props/handlers reachable from the window listeners without re-binding.
  const handlersRef = useRef({ onAddEvent, onUpdateEvent, onOpenActivity, blocks, byId });
  handlersRef.current = { onAddEvent, onUpdateEvent, onOpenActivity, blocks, byId };

  function setDrag(next: DragState | null) {
    dragRef.current = next;
    setDragInternal(next);
  }

  const filled = blocks.length;

  useEffect(() => {
    const scroller = calScrollRef.current;
    if (!scroller) return;
    const earliestBlockStart = blocks.length
      ? Math.min(...blocks.map((block) => blockStartMin(block)))
      : 8 * 60;
    const anchorMin = Math.max(DAY_START_MIN, Math.min(earliestBlockStart, 8 * 60));
    const frame = window.requestAnimationFrame(() => {
      const scrollable = scroller.scrollHeight - scroller.clientHeight;
      if (scrollable > 0) {
        scroller.scrollTop = Math.max(0, (anchorMin / TOTAL_MIN) * scroller.scrollHeight - 18);
      }
    });
    return () => window.cancelAnimationFrame(frame);
    // Re-anchor only when the user switches days; adding or moving events should not jump the scroller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIndex]);

  function clientYToMin(clientY: number): number {
    const el = gridRef.current;
    if (!el) return DAY_START_MIN;
    const rect = el.getBoundingClientRect();
    const ratio = (clientY - rect.top) / rect.height;
    return DAY_START_MIN + ratio * TOTAL_MIN;
  }

  function isOverGrid(x: number, y: number): boolean {
    const el = gridRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function handleEventClick(blockId: string) {
    const block = handlersRef.current.blocks.find((b) => b.id === blockId);
    if (!block) return;
    if (block.kind === "activity" && block.activityId) {
      const activity = handlersRef.current.byId[block.activityId];
      if (activity) {
        handlersRef.current.onOpenActivity(activity);
        return;
      }
    }
    openEditComposer(block);
  }

  // Global pointer listeners drive every drag (move / resize / create from library).
  useEffect(() => {
    function onMove(event: PointerEvent) {
      const current = dragRef.current;
      if (!current) return;
      event.preventDefault();

      if (current.type === "move") {
        const raw = clientYToMin(event.clientY) - current.grabOffsetMin;
        const startMin = clampStart(snapMinutes(raw), current.durationMin);
        setDrag({
          ...current,
          startMin,
          endMin: startMin + current.durationMin,
          moved: current.moved || startMin !== current.startMin,
        });
      } else if (current.type === "resize") {
        const raw = clientYToMin(event.clientY);
        const endMin = Math.min(
          DAY_END_MIN,
          Math.max(current.startMin + MIN_DURATION_MIN, snapMinutes(raw))
        );
        setDrag({ ...current, endMin });
      } else {
        const over = isOverGrid(event.clientX, event.clientY);
        const startMin = clampStart(snapMinutes(clientYToMin(event.clientY)), current.durationMin);
        setDrag({
          ...current,
          clientX: event.clientX,
          clientY: event.clientY,
          over,
          startMin,
          endMin: startMin + current.durationMin,
        });
      }
    }

    function onUp() {
      const current = dragRef.current;
      if (!current) return;
      const handlers = handlersRef.current;

      if (current.type === "move") {
        if (current.moved) {
          suppressClickRef.current = true;
          handlers.onUpdateEvent(current.blockId, {
            start: minutesToCamp(current.startMin),
            end: minutesToCamp(current.endMin),
          });
        } else {
          handleEventClick(current.blockId);
        }
      } else if (current.type === "resize") {
        suppressClickRef.current = true;
        handlers.onUpdateEvent(current.blockId, { end: minutesToCamp(current.endMin) });
      } else if (current.over) {
        suppressClickRef.current = true;
        handlers.onAddEvent({
          kind: "activity",
          activityId: current.activity.id,
          label: current.activity.title,
          start: minutesToCamp(current.startMin),
          end: minutesToCamp(current.endMin),
        });
      }
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startMove(event: ReactPointerEvent, block: ScheduleBlock) {
    if (event.button != null && event.button !== 0) return;
    const startMin = blockStartMin(block);
    const endMin = blockEndMin(block);
    setDrag({
      type: "move",
      blockId: block.id,
      grabOffsetMin: clientYToMin(event.clientY) - startMin,
      durationMin: endMin - startMin,
      startMin,
      endMin,
      moved: false,
    });
  }

  function startResize(event: ReactPointerEvent, block: ScheduleBlock) {
    event.stopPropagation();
    setDrag({
      type: "resize",
      blockId: block.id,
      startMin: blockStartMin(block),
      endMin: blockEndMin(block),
    });
  }

  function startLibraryDrag(event: ReactPointerEvent, activity: Activity) {
    event.preventDefault();
    const durationMin = Math.max(MIN_DURATION_MIN, activity.durationMin);
    setDrag({
      type: "create",
      activity,
      durationMin,
      startMin: DAY_START_MIN,
      endMin: DAY_START_MIN + durationMin,
      clientX: event.clientX,
      clientY: event.clientY,
      over: false,
    });
  }

  function openAddComposer(startMin?: number) {
    const start = startMin == null ? nextFreeStart(blocks, DEFAULT_DURATION_MIN) : startMin;
    setComposer({
      tab: "library",
      label: "",
      start: minutesToCamp(clampStart(snapMinutes(start), DEFAULT_DURATION_MIN)),
      durationMin: DEFAULT_DURATION_MIN,
    });
  }

  function openEditComposer(block: ScheduleBlock) {
    const startMin = blockStartMin(block);
    const durationMin = blockEndMin(block) - startMin;
    setComposer({
      blockId: block.id,
      tab: block.kind === "label" ? "custom" : "library",
      activityId: block.activityId,
      label: block.label,
      start: minutesToCamp(startMin),
      durationMin,
    });
  }

  function handleGridClick(event: React.MouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (event.target !== event.currentTarget) return;
    openAddComposer(clientYToMin(event.clientY));
  }

  function submitComposer(draft: EventDraft, blockId?: string) {
    if (blockId) {
      onUpdateEvent(blockId, {
        kind: draft.kind,
        label: draft.label,
        start: draft.start,
        end: draft.end,
        activityId: draft.kind === "activity" ? draft.activityId : undefined,
      });
    } else {
      onAddEvent(draft);
    }
    setComposer(null);
  }

  // Build positioned events, applying any live drag preview.
  const positioned = useMemo(() => {
    const items: Omit<Laid, "col" | "cols">[] = blocks.map((block) => {
      if (drag && (drag.type === "move" || drag.type === "resize") && drag.blockId === block.id) {
        return { block, startMin: drag.startMin, endMin: drag.endMin, dragging: true };
      }
      return { block, startMin: blockStartMin(block), endMin: blockEndMin(block) };
    });
    if (drag && drag.type === "create" && drag.over) {
      items.push({ block: null, startMin: drag.startMin, endMin: drag.endMin, ghost: true, dragging: true });
    }
    return layoutEvents(items);
  }, [blocks, drag]);

  const marks = hourMarks();

  return (
    <div className="planner planner--calendar fadein">
      <div className="cal-head">
        <div className="cal-head__copy">
          <span className="cal-head__kicker">Build the day</span>
          <h1 className="cal-head__title">{DAYS[dayIndex]}</h1>
          <span className="cal-head__sub">
            {filled} {filled === 1 ? "event" : "events"} planned
          </span>
        </div>
        <div className="cal-head__tools">
          <div className="daynav">
            <button
              type="button"
              className="icon-btn"
              onClick={() => onDayChange(-1)}
              aria-label="Previous day"
              disabled={dayIndex === 0}
            >
              <CampIcon.ChevronLeft />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onDayChange(1)}
              aria-label="Next day"
              disabled={dayIndex === DAYS.length - 1}
            >
              <CampIcon.ChevronRight />
            </button>
          </div>
          <button type="button" className="btn btn--primary cal-add-btn" onClick={() => openAddComposer()}>
            <CampIcon.Plus />
            Add event
          </button>
        </div>
      </div>

      <div className="day-carousel cal-days" aria-label="Week days">
        {DAYS.map((day, index) => {
          const planned = (weekBlocks[index] || []).filter(
            (block) => block.kind === "activity" && block.activityId
          ).length;
          return (
            <button
              type="button"
              key={day}
              className={"day-chip" + (index === dayIndex ? " is-active" : "")}
              onClick={() => onDayChange(index - dayIndex)}
              aria-current={index === dayIndex ? "date" : undefined}
            >
              <span>{day.slice(0, 3)}</span>
              <strong>{index + 1}</strong>
              <small>{planned || "–"}</small>
            </button>
          );
        })}
      </div>

      <div className="schedule-workbench">
        <section className="cal" ref={calScrollRef} aria-label={DAYS[dayIndex] + " calendar"}>
          <div className="cal-axis" aria-hidden="true">
            {marks.map((mark) => (
              <span key={mark.min} className="cal-axis__mark" style={{ top: pct(mark.min) + "%" }}>
                {mark.label}
              </span>
            ))}
          </div>

          <div className="cal-grid" ref={gridRef} onClick={handleGridClick}>
            {marks.map((mark) => (
              <span
                key={mark.min}
                className={"cal-line" + (mark.min === DAY_END_MIN ? " cal-line--last" : "")}
                style={{ top: pct(mark.min) + "%" }}
              />
            ))}
            {marks.slice(0, -1).map((mark) => (
              <span key={"half-" + mark.min} className="cal-line cal-line--half" style={{ top: pct(mark.min + 30) + "%" }} />
            ))}

            {positioned.map((item) => {
              const style: CSSProperties = {
                top: pct(item.startMin) + "%",
                height: "calc(" + ((item.endMin - item.startMin) / TOTAL_MIN) * 100 + "% - 4px)",
                left: "calc(" + (item.col / item.cols) * 100 + "% + 3px)",
                width: "calc(" + 100 / item.cols + "% - 6px)",
              };

              if (item.ghost) {
                return (
                  <div key="ghost" className="cal-event cal-event--ghost" style={style}>
                    <span className="cal-event__time">{formatRange(item.startMin, item.endMin)}</span>
                    <span className="cal-event__title">{drag && drag.type === "create" ? drag.activity.title : ""}</span>
                  </div>
                );
              }

              const block = item.block as ScheduleBlock;
              const activity = block.activityId ? byId[block.activityId] : null;
              const isCustom = block.kind === "label" || !activity;
              const duration = item.endMin - item.startMin;
              const short = duration <= 20;
              const compact = duration <= 40;

              return (
                <div
                  key={block.id}
                  className={
                    "cal-event" +
                    (isCustom ? " cal-event--custom" : " cal-event--activity") +
                    (item.dragging ? " is-dragging" : "") +
                    (short ? " cal-event--short" : compact ? " cal-event--compact" : "")
                  }
                  style={style}
                  onPointerDown={(event) => startMove(event, block)}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="cal-event__body">
                    <span className="cal-event__time">{formatRange(item.startMin, item.endMin)}</span>
                    <span className="cal-event__title">{activity ? activity.title : block.label}</span>
                    {activity && <span className="cal-event__meta">{activityMeta(activity)}</span>}
                  </div>
                  <button
                    type="button"
                    className="cal-event__remove"
                    aria-label={"Remove " + (activity ? activity.title : block.label)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveEvent(block.id);
                    }}
                  >
                    <CampIcon.Close />
                  </button>
                  <span
                    className="cal-event__resize"
                    aria-hidden="true"
                    onPointerDown={(event) => startResize(event, block)}
                  />
                </div>
              );
            })}

            {!positioned.length && (
              <div className="cal-empty">
                <CampIcon.Calendar />
                <p>Nothing planned yet.</p>
                <span>Tap a time, drag an activity in, or use “Add event.”</span>
              </div>
            )}
          </div>
        </section>

        <ScheduleLibrary
          isOpen={libraryOpen}
          activities={activities}
          query={query}
          onQueryChange={onQueryChange}
          cat={cat}
          place={place}
          age={age}
          onCat={onCat}
          onPlace={onPlace}
          onAge={onAge}
          plans={plans}
          dayName={DAYS[dayIndex]}
          onToggle={() => setLibraryOpen((open) => !open)}
          onOpenActivity={onOpenActivity}
          onQuickAdd={onQuickAdd}
          onStartDrag={startLibraryDrag}
          onSavePlan={onSavePlan}
          onApplyPlan={onApplyPlan}
          onDeletePlan={onDeletePlan}
          isFav={isFav}
          onToggleFav={onToggleFav}
        />
      </div>

      {drag && drag.type === "create" && (
        <div
          className="cal-drag-ghost"
          style={{ left: drag.clientX, top: drag.clientY }}
          aria-hidden="true"
        >
          {drag.activity.title}
        </div>
      )}

      {composer && (
        <EventComposer
          dayName={DAYS[dayIndex]}
          allActivities={allActivities}
          initial={composer}
          onSubmit={submitComposer}
          onClose={() => setComposer(null)}
        />
      )}
    </div>
  );
}
