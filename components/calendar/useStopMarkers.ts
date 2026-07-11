import { useEffect, type MutableRefObject } from "react";
import { formatClock } from "@/lib/calendar/time";
import type { CalendarStop } from "@/lib/calendar/stops";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { ViewKey } from "@/lib/calendar/views";

// Stop markers: every reminder "stop" (the 0-min reminders sharing one exact
// start time) is painted into FullCalendar's own day columns
// (.fc-timegrid-col-frame), positioned by a top percentage of the day window —
// the exact mechanism the weather hour chips use, so stops ride the horizontal
// scroll AND the vertical hour-zoom for free and never enter FC's block-overlap
// layout. A stop renders as a quiet hairline + count dot at the column's right
// edge; real events stay native FC cards (never merged). A column is only
// rebuilt when that day's stops change (keyed), so the MutationObserver can't
// thrash. Clicks are caught in the CAPTURE phase and stopped before FC sees them.
//
// Extracted from CalendarShell as a leaf side-effect (twin of
// useWeatherColumnChips): it paints/refreshes the reminder-stop markers in FC's
// day columns and delegates marker press/click to the drag + open refs. Writes
// no component state; all inputs are read-only (stops/gridStart/gridEnd/
// activeView/stopDotColor drive the same hand-tuned dep array as before).
export function useStopMarkers({
  gridRef,
  stops,
  gridStart,
  gridEnd,
  activeView,
  stopDotColor,
  remDraggedRef,
  beginReminderDragRef,
  openStopRef,
}: {
  gridRef: MutableRefObject<HTMLDivElement | null>;
  stops: CalendarStop[];
  gridStart: number;
  gridEnd: number;
  activeView: ViewKey;
  stopDotColor: (event: CalendarEvent) => string;
  remDraggedRef: MutableRefObject<boolean>;
  beginReminderDragRef: MutableRefObject<(marker: HTMLElement, e: PointerEvent) => void>;
  openStopRef: MutableRefObject<(ids: string[], anchor: DOMRect) => void>;
}) {
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
}
