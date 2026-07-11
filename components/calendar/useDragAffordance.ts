import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

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
//
// Extracted from CalendarShell as a self-contained hook: it owns the ghost-card
// follower + body-class affordances for a move/resize, closing over only the
// grid element and the live selection. Returns the handles the shell wires to
// FullCalendar (start/stop) plus the two refs the drop reads (followRef in JSX,
// altDragRef for copy-vs-move).
export function useDragAffordance({
  gridRef,
  selectionRef,
}: {
  gridRef: MutableRefObject<HTMLDivElement | null>;
  selectionRef: MutableRefObject<ReadonlySet<string>>;
}) {
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

  return {
    followRef,
    startMoveAffordance,
    startResizeAffordance,
    stopDragAffordance,
    altDragRef,
  };
}
