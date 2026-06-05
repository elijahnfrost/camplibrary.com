"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Activity, ApplyMode, DaySchedule, DayTemplate, ScheduleBlock } from "@/lib/types";
import { activityMeta, categoryTint, DAYS } from "@/lib/data";
import type { MaterialOption } from "@/lib/materials";
import {
  blockEndMin,
  blockStartMin,
  clampStart,
  clampZoomIndex,
  DAY_END_MIN,
  DAY_START_MIN,
  DEFAULT_DURATION_MIN,
  DEFAULT_ZOOM,
  DRAW_THRESHOLD_PX,
  formatClock,
  formatRange,
  hourMarks,
  MAX_COLS_DAY,
  MIN_DURATION_MIN,
  minutesToCamp,
  nextFreeStart,
  SNAP_MIN,
  snapMinutes,
  TOTAL_MIN,
  ZOOM_LEVELS,
} from "@/lib/scheduleTime";
import { layoutEvents, pct, type Laid, type LaidInput } from "@/lib/layoutEvents";
import { CampIcon } from "./icons";
import { type AgeFilter, type CatFilter, type PlaceFilter } from "./Filters";
import { DayNav } from "./DayNav";
import { ScheduleLibrary } from "./ScheduleLibrary";
import { CAT_LABEL, EventComposer, type ComposerState, type EventDraft } from "./EventComposer";
import { OverflowSheet } from "./OverflowSheet";
import { ApplyTemplateSheet } from "./ApplyTemplateSheet";

export type { EventDraft };

// ============================================================
// Drag / gesture state
// ============================================================

type DragState =
  | {
      type: "move";
      pointerId: number;
      blockId: string;
      grabOffsetMin: number;
      durationMin: number;
      originStartMin: number;
      startMin: number;
      endMin: number;
      moved: boolean;
      downX: number;
      downY: number;
    }
  | {
      type: "resize";
      pointerId: number;
      edge: "top" | "bottom";
      blockId: string;
      anchorMin: number;
      startMin: number;
      endMin: number;
    }
  | {
      type: "create";
      pointerId: number;
      activity: Activity;
      durationMin: number;
      startMin: number;
      endMin: number;
      clientX: number;
      clientY: number;
      over: boolean;
    }
  | {
      type: "draw";
      pointerId: number;
      pointerType: string;
      anchorMin: number;
      startMin: number;
      endMin: number;
      moved: boolean;
      hasMoved: boolean;
      downX: number;
      downY: number;
    };

type PinchState = { startDist: number; startIdx: number; midY: number };
const DAY_HOURS = TOTAL_MIN / 60;

function nearestZoomIndex(px: number): number {
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    const delta = Math.abs(ZOOM_LEVELS[i] - px);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

// ============================================================
// Calendar workspace
// ============================================================

export function CalendarView({
  dayIndex,
  onSelectDay,
  blocks,
  weekBlocks,
  activities,
  allActivities,
  query,
  onQueryChange,
  cat,
  place,
  age,
  materialOptions,
  availableMaterials,
  onCat,
  onPlace,
  onAge,
  onToggleMaterial,
  onClearMaterials,
  plans,
  openCount,
  onAddEvent,
  onUpdateEvent,
  onRemoveEvent,
  onQuickAdd,
  onSavePlan,
  onApplyTemplate,
  onDeletePlan,
  applyToast,
  onUndoApply,
  onDismissToast,
  onOpenActivity,
  isFav,
  onToggleFav,
  byId,
  zoomIdx,
  onZoom,
  focus,
}: {
  dayIndex: number;
  onSelectDay: (index: number) => void;
  blocks: DaySchedule;
  weekBlocks: Record<number, DaySchedule>;
  activities: Activity[];
  allActivities: Activity[];
  query: string;
  onQueryChange: (value: string) => void;
  cat: CatFilter;
  place: PlaceFilter;
  age: AgeFilter;
  materialOptions: MaterialOption[];
  availableMaterials: string[];
  onCat: (value: CatFilter) => void;
  onPlace: (value: PlaceFilter) => void;
  onAge: (value: AgeFilter) => void;
  onToggleMaterial: (id: string) => void;
  onClearMaterials: () => void;
  plans: DayTemplate[];
  openCount: number;
  onAddEvent: (draft: EventDraft) => void;
  onUpdateEvent: (blockId: string, patch: Partial<ScheduleBlock>) => void;
  onRemoveEvent: (blockId: string) => void;
  onQuickAdd: (activityId: string) => void;
  onSavePlan: (name: string) => void;
  onApplyTemplate: (templateId: string, targetDays: number[], mode: ApplyMode) => void;
  onDeletePlan: (planId: string) => void;
  applyToast: string | null;
  onUndoApply: () => void;
  onDismissToast: () => void;
  onOpenActivity: (activity: Activity) => void;
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  byId: Record<string, Activity>;
  zoomIdx: number;
  onZoom: (idx: number) => void;
  focus?: { min: number; nonce: number } | null;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [overflow, setOverflow] = useState<{ items: Laid[]; startMin: number; endMin: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState("");

  const gridRef = useRef<HTMLDivElement | null>(null);
  const calScrollRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDragInternal] = useState<DragState | null>(null);
  const suppressClickRef = useRef(false);

  // Pinch-to-zoom bookkeeping (touch).
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);
  const coarseRef = useRef(false);
  const zoomIdxRef = useRef(zoomIdx);
  zoomIdxRef.current = zoomIdx;

  function setDrag(next: DragState | null) {
    dragRef.current = next;
    setDragInternal(next);
  }

  function timeRatio(min: number): number {
    const clamped = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, min));
    return (clamped - DAY_START_MIN) / TOTAL_MIN;
  }

  // ---- zoom ----
  // Re-anchor the scroll so the time under the pinch midpoint / cursor stays put.
  function zoomToIndex(nextIdxRaw: number, anchorClientY: number) {
    const sc = calScrollRef.current;
    const idx = clampZoomIndex(nextIdxRaw);
    if (!sc) {
      onZoom(idx);
      return;
    }
    const rect = sc.getBoundingClientRect();
    const offset = anchorClientY - rect.top;
    const curPx = ZOOM_LEVELS[zoomIdxRef.current];
    const minAtAnchor = DAY_START_MIN + ((sc.scrollTop + offset) / (curPx * DAY_HOURS)) * TOTAL_MIN;
    onZoom(idx);
    const newPx = ZOOM_LEVELS[idx];
    window.requestAnimationFrame(() => {
      sc.scrollTop = Math.max(0, timeRatio(minAtAnchor) * (newPx * DAY_HOURS) - offset);
    });
  }
  const zoomToIndexRef = useRef(zoomToIndex);
  zoomToIndexRef.current = zoomToIndex;

  function viewportMidY(): number {
    const sc = calScrollRef.current;
    if (!sc) return 0;
    const rect = sc.getBoundingClientRect();
    return rect.top + rect.height / 2;
  }

  // Keep the latest props/handlers reachable from the window listeners.
  const handlersRef = useRef({
    onAddEvent,
    onUpdateEvent,
    blocks,
    openAddComposer: (_min?: number) => {},
    openDrawComposer: (_s: number, _e: number) => {},
  });

  useEffect(() => {
    coarseRef.current = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  }, []);

  function dragThreshold(): number {
    return coarseRef.current ? 12 : DRAW_THRESHOLD_PX;
  }

  // Anchor the scroll near 8am (or the earliest event) when the day changes.
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
        scroller.scrollTop = Math.max(0, timeRatio(anchorMin) * scroller.scrollHeight - 18);
      }
    });
    return () => window.cancelAnimationFrame(frame);
    // Re-anchor only when the user switches days.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIndex]);

  // Scroll to a specific time when navigated here from the overview.
  useEffect(() => {
    if (!focus) return;
    const scroller = calScrollRef.current;
    if (!scroller) return;
    const frame = window.requestAnimationFrame(() => {
      scroller.scrollTop = Math.max(0, timeRatio(focus.min) * scroller.scrollHeight - 24);
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

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
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const block = handlersRef.current.blocks.find((b) => b.id === blockId);
    if (block) openEditComposer(block);
  }

  function suppressNextClick() {
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  // ---- global pointer listeners drive every drag + pinch ----
  useEffect(() => {
    function onMove(event: PointerEvent) {
      // Pinch takes precedence over any single-pointer gesture.
      if (pinchRef.current && pointersRef.current.size >= 2) {
        event.preventDefault();
        if (pointersRef.current.has(event.pointerId)) {
          pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }
        const pts = [...pointersRef.current.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const targetPx = ZOOM_LEVELS[pinchRef.current.startIdx] * (dist / pinchRef.current.startDist);
        const targetIdx = nearestZoomIndex(targetPx);
        if (targetIdx !== zoomIdxRef.current) {
          zoomToIndexRef.current(targetIdx, pinchRef.current.midY);
        }
        return;
      }

	      const current = dragRef.current;
	      if (!current) return;
	      if (event.pointerId !== current.pointerId) return;

	      // A one-finger draw on blank grid must yield to native scrolling on touch;
      // the press is resolved as a tap on pointerup instead.
      if (current.type === "draw" && current.pointerType === "touch") return;

      event.preventDefault();

      if (current.type === "move") {
        const raw = clientYToMin(event.clientY) - current.grabOffsetMin;
        const startMin = clampStart(snapMinutes(raw), current.durationMin);
        const dist = Math.hypot(event.clientX - current.downX, event.clientY - current.downY);
        setDrag({
          ...current,
          startMin,
          endMin: startMin + current.durationMin,
          moved: current.moved || dist >= dragThreshold(),
        });
      } else if (current.type === "resize") {
        const y = snapMinutes(clientYToMin(event.clientY));
        if (current.edge === "bottom") {
          const endMin = Math.min(DAY_END_MIN, Math.max(current.anchorMin + MIN_DURATION_MIN, y));
          setDrag({ ...current, startMin: current.anchorMin, endMin });
        } else {
          const startMin = Math.max(DAY_START_MIN, Math.min(current.anchorMin - MIN_DURATION_MIN, y));
          setDrag({ ...current, startMin, endMin: current.anchorMin });
        }
	      } else if (current.type === "draw") {
	        const cur = snapMinutes(clientYToMin(event.clientY));
	        const startMin = Math.max(DAY_START_MIN, Math.min(current.anchorMin, cur));
	        const endMin = Math.min(DAY_END_MIN, Math.max(current.anchorMin, cur));
	        const dist = Math.hypot(event.clientX - current.downX, event.clientY - current.downY);
	        const hasMoved = current.hasMoved || dist >= dragThreshold();
	        const moved = current.moved || (hasMoved && endMin - startMin >= SNAP_MIN);
	        setDrag({ ...current, startMin, endMin, moved, hasMoved });
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

    function finishPointer(pointerId: number) {
      pointersRef.current.delete(pointerId);
      if (pinchRef.current && pointersRef.current.size < 2) pinchRef.current = null;
    }

	    function onUp(event: PointerEvent) {
	      const wasPinching = Boolean(pinchRef.current);
	      finishPointer(event.pointerId);
	      const current = dragRef.current;
	      if (!current || event.pointerId !== current.pointerId) {
	        if (wasPinching && pointersRef.current.size === 0) setDrag(null);
	        return;
	      }
	      if (wasPinching) {
	        if (pointersRef.current.size === 0) setDrag(null);
	        return;
	      }
      const handlers = handlersRef.current;

      if (current.type === "move") {
        if (current.moved && current.startMin !== current.originStartMin) {
          suppressNextClick();
          handlers.onUpdateEvent(current.blockId, {
            start: minutesToCamp(current.startMin),
            end: minutesToCamp(current.endMin),
          });
        } else if (current.moved) {
          // Dragged but landed back on the original time — swallow the click.
          suppressNextClick();
        }
        // An un-moved press falls through to the open button's click → edit.
      } else if (current.type === "resize") {
        suppressNextClick();
        handlers.onUpdateEvent(current.blockId, {
          start: minutesToCamp(current.startMin),
          end: minutesToCamp(current.endMin),
        });
	      } else if (current.type === "draw") {
	        if (current.moved) {
	          handlers.openDrawComposer(current.startMin, current.endMin);
	        } else if (!current.hasMoved) {
	          handlers.openAddComposer(current.anchorMin);
	        }
      } else if (current.over) {
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

	    function onCancel(event: PointerEvent) {
	      finishPointer(event.pointerId);
	      const current = dragRef.current;
	      if (!current || event.pointerId === current.pointerId || pointersRef.current.size === 0) setDrag(null);
	    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- ctrl/⌘ + wheel to zoom (imperative for non-passive preventDefault) ----
  useEffect(() => {
    const el = calScrollRef.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      zoomToIndexRef.current(zoomIdxRef.current + (event.deltaY < 0 ? 1 : -1), event.clientY);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- gesture starters ----
  function onCalPointerDown(event: ReactPointerEvent) {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      pinchRef.current = {
        startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        startIdx: zoomIdxRef.current,
        midY: (pts[0].y + pts[1].y) / 2,
      };
      setDrag(null); // cancel any nascent single-finger drag
    }
  }

  function startMove(event: ReactPointerEvent, block: ScheduleBlock) {
    if (event.button != null && event.button !== 0) return;
    if (pinchRef.current || pointersRef.current.size >= 2) return;
    const startMin = blockStartMin(block);
    const endMin = blockEndMin(block);
    setDrag({
      type: "move",
      pointerId: event.pointerId,
      blockId: block.id,
      grabOffsetMin: clientYToMin(event.clientY) - startMin,
      durationMin: endMin - startMin,
      originStartMin: startMin,
      startMin,
      endMin,
      moved: false,
      downX: event.clientX,
      downY: event.clientY,
    });
  }

  function startResize(event: ReactPointerEvent, block: ScheduleBlock, edge: "top" | "bottom") {
    event.stopPropagation();
    if (event.button != null && event.button !== 0) return;
    if (pinchRef.current || pointersRef.current.size >= 2) return;
    const startMin = blockStartMin(block);
    const endMin = blockEndMin(block);
    setDrag({
      type: "resize",
      pointerId: event.pointerId,
      edge,
      blockId: block.id,
      anchorMin: edge === "bottom" ? startMin : endMin,
      startMin,
      endMin,
    });
  }

  function startDraw(event: ReactPointerEvent) {
    if (event.target !== event.currentTarget) return; // only blank grid
    if (event.button != null && event.button !== 0) return;
    if (pinchRef.current || pointersRef.current.size >= 2) return;
    const anchorMin = snapMinutes(clientYToMin(event.clientY));
    setDrag({
      type: "draw",
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      anchorMin,
      startMin: anchorMin,
      endMin: anchorMin,
      moved: false,
      hasMoved: false,
      downX: event.clientX,
      downY: event.clientY,
    });
  }

  function startLibraryDrag(event: ReactPointerEvent, activity: Activity) {
    event.preventDefault();
    const durationMin = Math.max(MIN_DURATION_MIN, activity.durationMin);
    setDrag({
      type: "create",
      pointerId: event.pointerId,
      activity,
      durationMin,
      startMin: DAY_START_MIN,
      endMin: DAY_START_MIN + durationMin,
      clientX: event.clientX,
      clientY: event.clientY,
      over: false,
    });
  }

  // ---- composer ----
  function openAddComposer(startMin?: number) {
    const start = startMin == null ? nextFreeStart(blocks, DEFAULT_DURATION_MIN) : startMin;
    setComposer({
      tab: "library",
      label: "",
      start: minutesToCamp(clampStart(snapMinutes(start), DEFAULT_DURATION_MIN)),
      durationMin: DEFAULT_DURATION_MIN,
    });
  }

  function openDrawComposer(startMin: number, endMin: number) {
    const duration = Math.max(MIN_DURATION_MIN, endMin - startMin);
    setComposer({
      tab: "library",
      label: "",
      start: minutesToCamp(clampStart(startMin, duration)),
      durationMin: duration,
    });
  }

  function openEditComposer(block: ScheduleBlock) {
    const startMin = blockStartMin(block);
    const durationMin = blockEndMin(block) - startMin;
    const tab: ComposerState["tab"] =
      block.kind === "label" ? "custom" : block.fill === "conditional" ? "open" : "library";
    setComposer({
      blockId: block.id,
      tab,
      activityId: block.activityId,
      label: block.label,
      start: minutesToCamp(startMin),
      durationMin,
      category: block.category,
      rule: block.rule,
    });
  }

  handlersRef.current = { onAddEvent, onUpdateEvent, blocks, openAddComposer, openDrawComposer };

  function submitComposer(draft: EventDraft, blockId?: string) {
    if (blockId) {
      onUpdateEvent(blockId, {
        kind: draft.kind,
        label: draft.label,
        start: draft.start,
        end: draft.end,
        activityId: draft.kind === "activity" ? draft.activityId : undefined,
        fill: draft.fill ?? "fixed",
        category: draft.category,
        rule: draft.rule,
      });
    } else {
      onAddEvent(draft);
    }
    setComposer(null);
  }

  function onEventKey(event: ReactKeyboardEvent, block: ScheduleBlock) {
    const start = blockStartMin(block);
    const end = blockEndMin(block);
    const dur = end - start;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const dir = event.key === "ArrowDown" ? 1 : -1;
      if (event.shiftKey) {
        const newEnd = Math.min(DAY_END_MIN, Math.max(start + MIN_DURATION_MIN, end + dir * SNAP_MIN));
        onUpdateEvent(block.id, { end: minutesToCamp(newEnd) });
        setStatusMsg("Resized " + block.label + " to " + formatRange(start, newEnd));
      } else {
        const newStart = clampStart(start + dir * SNAP_MIN, dur);
        onUpdateEvent(block.id, { start: minutesToCamp(newStart), end: minutesToCamp(newStart + dur) });
        setStatusMsg("Moved " + block.label + " to " + formatRange(newStart, newStart + dur));
      }
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemoveEvent(block.id);
      setStatusMsg("Removed " + block.label);
    }
  }

  function onResizeKey(event: ReactKeyboardEvent, block: ScheduleBlock, edge: "top" | "bottom") {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const dir = event.key === "ArrowDown" ? 1 : -1;
    const start = blockStartMin(block);
    const end = blockEndMin(block);
    if (edge === "bottom") {
      const newEnd = Math.min(DAY_END_MIN, Math.max(start + MIN_DURATION_MIN, end + dir * SNAP_MIN));
      onUpdateEvent(block.id, { end: minutesToCamp(newEnd) });
      setStatusMsg("Resized " + block.label + " to " + formatRange(start, newEnd));
    } else {
      const newStart = Math.max(DAY_START_MIN, Math.min(end - MIN_DURATION_MIN, start + dir * SNAP_MIN));
      onUpdateEvent(block.id, { start: minutesToCamp(newStart) });
      setStatusMsg("Resized " + block.label + " to " + formatRange(newStart, end));
    }
  }

  // Build positioned events with any live drag preview, then cap overlap columns.
  const positioned = useMemo(() => {
    const items: LaidInput[] = blocks.map((block) => {
      if (drag && (drag.type === "move" || drag.type === "resize") && drag.blockId === block.id) {
        return { block, startMin: drag.startMin, endMin: drag.endMin, dragging: true };
      }
      return { block, startMin: blockStartMin(block), endMin: blockEndMin(block) };
    });
    if (drag && drag.type === "create" && drag.over) {
      items.push({ block: null, startMin: drag.startMin, endMin: drag.endMin, ghost: true, dragging: true });
    }
    if (drag && drag.type === "draw" && drag.moved) {
      items.push({ block: null, startMin: drag.startMin, endMin: drag.endMin, ghost: true, dragging: true });
    }
    return layoutEvents(items, MAX_COLS_DAY);
  }, [blocks, drag]);

  const marks = hourMarks();
  const calStyle = {
    "--hour-px": ZOOM_LEVELS[zoomIdx] + "px",
    "--day-hours": DAY_HOURS,
  } as CSSProperties;

  return (
    <div className="planner planner--calendar fadein">
      <div className="cal-head">
        <div className="cal-head__copy">
          <h1 ref={headingRef} tabIndex={-1} className="cal-head__title">
            {DAYS[dayIndex]}
          </h1>
        </div>
        <div className="cal-head__tools">
          <div className="cal-zoom" role="group" aria-label="Zoom timeline">
            <button
              type="button"
              className="cal-zoom__btn"
              onClick={() => zoomToIndex(zoomIdx - 1, viewportMidY())}
              aria-label="Zoom out"
              disabled={zoomIdx === 0}
            >
              <span aria-hidden="true">−</span>
            </button>
            <input
              className="cal-zoom__range"
              type="range"
              min={0}
              max={ZOOM_LEVELS.length - 1}
              step={1}
              value={zoomIdx}
              onChange={(event) => zoomToIndex(Number(event.currentTarget.value), viewportMidY())}
              aria-label="Timeline zoom level"
              aria-valuetext={ZOOM_LEVELS[zoomIdx] + " pixels per hour"}
            />
            <span className="cal-zoom__value" aria-hidden="true">
              {Math.round((ZOOM_LEVELS[zoomIdx] / ZOOM_LEVELS[DEFAULT_ZOOM]) * 100)}%
            </span>
            <button
              type="button"
              className="cal-zoom__btn"
              onClick={() => zoomToIndex(zoomIdx + 1, viewportMidY())}
              aria-label="Zoom in"
              disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
          <div className="daynav">
            <button
              type="button"
              className="icon-btn"
              onClick={() => onSelectDay(dayIndex - 1)}
              aria-label="Previous day"
              disabled={dayIndex === 0}
            >
              <CampIcon.ChevronLeft />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onSelectDay(dayIndex + 1)}
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
	      <span className="sr-only" aria-live="polite">
	        {ZOOM_LEVELS[zoomIdx]} pixels per hour{statusMsg ? ". " + statusMsg : ""}
	      </span>

      <DayNav dayIndex={dayIndex} weekBlocks={weekBlocks} onSelectDay={onSelectDay} />

      <div className="schedule-workbench">
        <section
          className={"cal" + (drag && drag.type !== "create" ? " cal--busy" : "")}
          ref={calScrollRef}
          style={calStyle}
          aria-label={DAYS[dayIndex] + " calendar"}
        >
          <div className="cal-axis" aria-hidden="true">
            {marks.map((mark) => (
              <span key={mark.min} className="cal-axis__mark" style={{ top: pct(mark.min) + "%" }}>
                {mark.label}
              </span>
            ))}
          </div>

	          <div className="cal-grid" ref={gridRef} onPointerDownCapture={onCalPointerDown}>
            <div className="cal-grid__surface" onPointerDown={startDraw}>
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
            </div>

            {positioned.map((item) => {
              const style: CSSProperties = {
                top: pct(item.startMin) + "%",
                height: "calc(" + ((item.endMin - item.startMin) / TOTAL_MIN) * 100 + "% - 4px)",
                left: "calc(" + (item.col / item.cols) * 100 + "% + 3px)",
                width: "calc(" + 100 / item.cols + "% - 6px)",
              };

              if (item.overflow) {
                const hiddenItems = item.hiddenItems || [];
                return (
                  <button
                    key={"more-" + item.startMin + "-" + item.col}
                    type="button"
                    className="cal-event cal-event--more"
                    style={style}
                    aria-haspopup="dialog"
                    aria-label={hiddenItems.length + " more events, " + formatRange(item.startMin, item.endMin)}
                    onClick={() => setOverflow({ items: hiddenItems, startMin: item.startMin, endMin: item.endMin })}
                  >
                    +{hiddenItems.length} more
                  </button>
                );
              }

              if (item.ghost) {
                const ghostLabel =
                  drag && drag.type === "create" ? drag.activity.title : "New event";
                return (
                  <div key="ghost" className="cal-event cal-event--ghost" style={style}>
                    <span className="cal-event__time">{formatRange(item.startMin, item.endMin)}</span>
                    <span className="cal-event__title">{ghostLabel}</span>
                  </div>
                );
              }

	              const block = item.block as ScheduleBlock;
	              const activity = block.activityId ? byId[block.activityId] : null;
	              const isLabel = block.kind === "label";
	              const isOpen = (block.fill === "open" || block.fill === "conditional") && !activity;
	              const isCustom = isLabel;
	              const duration = item.endMin - item.startMin;
	              const short = duration <= 20;
	              const compact = duration <= 50;
	              const tint = activity
	                ? categoryTint(activity.type)
	                : isOpen && block.category
	                  ? categoryTint(block.category)
	                  : undefined;
	              const name = activity
	                ? activity.title
	                : isOpen
	                  ? "Choose a " + (block.category ? CAT_LABEL[block.category] : "activity")
	                  : block.label;
	              const eventStyle: CSSProperties = tint ? { ...style, "--cat": tint } as CSSProperties : style;
	              const editLabel =
	                (isOpen ? "Fill " : "Edit ") +
	                name +
	                ", " +
	                formatRange(item.startMin, item.endMin) +
	                ". Arrow keys move it; Shift with arrows resizes; Delete removes.";

              return (
                <div
                  key={block.id}
                  className={
	                    "cal-event" +
	                    (isOpen ? " cal-event--open" : isCustom ? " cal-event--custom" : " cal-event--activity") +
	                    (item.dragging ? " is-dragging" : "") +
	                    (short ? " cal-event--short" : compact ? " cal-event--compact" : "")
	                  }
	                  style={eventStyle}
	                  onPointerDown={(event) => startMove(event, block)}
	                >
	                  <div
	                    role="slider"
	                    tabIndex={0}
	                    className="cal-event__resize cal-event__resize--top"
	                    aria-label={"Resize start of " + name}
	                    aria-valuemin={DAY_START_MIN}
	                    aria-valuemax={Math.max(DAY_START_MIN, item.endMin - MIN_DURATION_MIN)}
	                    aria-valuenow={item.startMin}
	                    aria-valuetext={"Starts " + formatClock(item.startMin)}
	                    onPointerDown={(event) => startResize(event, block, "top")}
	                    onKeyDown={(event) => onResizeKey(event, block, "top")}
	                  />
	                  <button
                    type="button"
                    className="cal-event__open"
                    aria-label={editLabel}
                    onClick={() => handleEventClick(block.id)}
                    onKeyDown={(event) => onEventKey(event, block)}
                  >
                    <span className="cal-event__body" aria-hidden="true">
	                      <span className="cal-event__time">{formatRange(item.startMin, item.endMin)}</span>
	                      <span className="cal-event__title">{name}</span>
	                      {activity && <span className="cal-event__meta">{activityMeta(activity)}</span>}
	                      {isOpen && <span className="cal-event__meta">tap to choose</span>}
	                    </span>
	                  </button>
                  <button
                    type="button"
                    className="cal-event__remove"
                    aria-label={"Remove " + name}
                    onPointerDown={(event) => event.stopPropagation()}
	                    onClick={(event) => {
	                      event.stopPropagation();
	                      onRemoveEvent(block.id);
	                      setStatusMsg("Removed " + name);
	                    }}
	                  >
	                    <CampIcon.Close />
	                  </button>
	                  <div
	                    role="slider"
	                    tabIndex={0}
	                    className="cal-event__resize cal-event__resize--bottom"
	                    aria-label={"Resize end of " + name}
	                    aria-valuemin={Math.min(DAY_END_MIN, item.startMin + MIN_DURATION_MIN)}
	                    aria-valuemax={DAY_END_MIN}
	                    aria-valuenow={item.endMin}
	                    aria-valuetext={"Ends " + formatClock(item.endMin)}
	                    onPointerDown={(event) => startResize(event, block, "bottom")}
	                    onKeyDown={(event) => onResizeKey(event, block, "bottom")}
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
	            {openCount > 0 && (
	              <span className="cal-openflag" aria-hidden="true">
	                {openCount} to fill
	              </span>
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
          materialOptions={materialOptions}
          availableMaterials={availableMaterials}
          onCat={onCat}
          onPlace={onPlace}
          onAge={onAge}
          onToggleMaterial={onToggleMaterial}
          onClearMaterials={onClearMaterials}
          plans={plans}
          dayName={DAYS[dayIndex]}
          onToggle={() => setLibraryOpen((open) => !open)}
          onOpenActivity={onOpenActivity}
          onQuickAdd={onQuickAdd}
	          onStartDrag={startLibraryDrag}
	          onSavePlan={onSavePlan}
	          onRequestApply={(planId) => setApplyTemplateId(planId)}
	          onDeletePlan={onDeletePlan}
          isFav={isFav}
          onToggleFav={onToggleFav}
        />
      </div>

      {drag && drag.type === "create" && (
        <div className="cal-drag-ghost" style={{ left: drag.clientX, top: drag.clientY }} aria-hidden="true">
          {drag.activity.title}
        </div>
      )}

      {overflow && (
        <OverflowSheet
          items={overflow.items}
          startMin={overflow.startMin}
          endMin={overflow.endMin}
          byId={byId}
          onEdit={(block) => {
            setOverflow(null);
            openEditComposer(block);
          }}
          onRemove={(blockId) => {
            onRemoveEvent(blockId);
            setOverflow(null);
          }}
          onClose={() => setOverflow(null)}
        />
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

	      {applyTemplateId &&
	        (() => {
	          const template = plans.find((plan) => plan.id === applyTemplateId);
	          if (!template) return null;
	          return (
	            <ApplyTemplateSheet
	              template={template}
	              dayIndex={dayIndex}
	              weekBlocks={weekBlocks}
	              onConfirm={(targetDays, mode) => {
	                onApplyTemplate(template.id, targetDays, mode);
	                setApplyTemplateId(null);
	              }}
	              onClose={() => setApplyTemplateId(null)}
	            />
	          );
	        })()}

	      {applyToast && (
	        <div className="apply-toast" role="status">
	          <span>{applyToast}</span>
	          <button type="button" onClick={onUndoApply}>
	            Undo
	          </button>
	          <button type="button" className="apply-toast__close" onClick={onDismissToast} aria-label="Dismiss">
	            <CampIcon.Close />
	          </button>
	        </div>
	      )}
	    </div>
	  );
	}
