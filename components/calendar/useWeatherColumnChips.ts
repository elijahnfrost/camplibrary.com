import { useEffect, type MutableRefObject } from "react";
import {
  conditionLabel,
  formatTemp,
  weatherGlyphSvg,
  type WeatherData,
  type WeatherMode,
} from "@/lib/weather";
import type { ViewKey } from "@/lib/calendar/views";
import type { WeatherPopoverTarget } from "./WeatherPopover";

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
//
// Extracted from CalendarShell as a leaf side-effect: it paints/refreshes the
// hour chips inside FC's day columns and delegates chip clicks to openWxRef. It
// writes no component state — everything it needs comes in as read-only params
// (weatherData/activeView drive the same hand-tuned dep array as before).
export function useWeatherColumnChips({
  gridRef,
  weatherMode,
  weatherData,
  weatherDataRef,
  gridStart,
  gridEnd,
  activeView,
  openWxRef,
}: {
  gridRef: MutableRefObject<HTMLDivElement | null>;
  weatherMode: WeatherMode;
  weatherData: WeatherData | null;
  weatherDataRef: MutableRefObject<WeatherData | null>;
  gridStart: number;
  gridEnd: number;
  activeView: ViewKey;
  openWxRef: MutableRefObject<(target: WeatherPopoverTarget, anchor: DOMRect) => void>;
}) {
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
}
