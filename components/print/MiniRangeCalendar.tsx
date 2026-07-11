"use client";

// An inline mini-month for the Print tab's date picker. Two ways to grab a range,
// so it works with mouse, keyboard, AND touch:
//   • Tap a start day, then tap an end day (the second tap closes the range).
//   • Shift-click (or Shift+Enter) a day to extend straight from the start — the
//     quick path for "this Mon through Fri" on a pointer.
// After a range is set, the next plain tap starts a fresh one. It reuses the
// sidebar mini-month's look (.cal-mini__* classes + the in-view band) so it reads
// as the same calendar, just range-aware.

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, daySpan, fromDateKey, startOfWeek, toDateKey } from "@/lib/calendar/dates";
import type { DateKey } from "@/lib/calendar/types";
import { CampIcon } from "../ui/icons";

export interface DateRange {
  start: DateKey;
  end: DateKey;
}

// Inclusive [lo, hi] from a fixed anchor to a clicked day, clamped so the span
// never exceeds maxDays (the far end is reeled back toward the anchor).
// `clamped` tells the caller whether the pick actually got reeled in, so it
// can surface feedback (print-11) instead of silently snapping the range back.
function rangeFromAnchor(anchor: DateKey, picked: DateKey, maxDays: number): DateRange & { clamped: boolean } {
  const forward = fromDateKey(picked).getTime() >= fromDateKey(anchor).getTime();
  const inclusive = Math.abs(daySpan(anchor, picked)) + 1;
  const clamped = inclusive > maxDays;
  let end = picked;
  if (clamped) end = addDays(anchor, (forward ? 1 : -1) * (maxDays - 1));
  const lo = forward ? anchor : end;
  const hi = forward ? end : anchor;
  return { start: lo, end: hi, clamped };
}

export function MiniRangeCalendar({
  value,
  onChange,
  maxDays,
  today,
  firstDay = 1,
  onClamped,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Hard cap on the selectable span, matching the print range limit. */
  maxDays: number;
  today: DateKey;
  firstDay?: number;
  /** Called (with the cap) when a pick gets reeled back to maxDays, so the
   *  caller can surface visible feedback (print-11) — a silent clamp reads as
   *  a bug ("I picked further than this"). Optional: omitting it just skips
   *  the feedback, it never affects the clamped range itself. */
  onClamped?: (maxDays: number) => void;
}) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = fromDateKey(value.start);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  // The open start of a two-tap range. Non-null means "waiting for the end tap";
  // null means the last selection is complete and the next tap starts fresh.
  const [pending, setPending] = useState<DateKey | null>(null);
  // What we last emitted, so an *external* value change (a preset button) can be
  // told apart from our own click and resync the shown month / abandon a pending
  // range.
  const lastEmit = useRef<DateRange>(value);

  useEffect(() => {
    if (value.start === lastEmit.current.start && value.end === lastEmit.current.end) return;
    lastEmit.current = value;
    setPending(null);
    const d = fromDateKey(value.start);
    setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [value]);

  const weekdays = useMemo(() => {
    const base = startOfWeek(new Date(2024, 0, 7), firstDay);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
    });
  }, [firstDay]);

  // Stable 6-row (42-cell) grid so the panel height never jumps month to month.
  const weeks = useMemo(() => {
    const gridStart = startOfWeek(monthCursor, firstDay);
    return Array.from({ length: 6 }, (_, w) =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + w * 7 + i);
        return d;
      })
    );
  }, [monthCursor, firstDay]);

  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const cursorMonth = monthCursor.getMonth();
  const stepMonth = (delta: number) =>
    setMonthCursor((cur) => new Date(cur.getFullYear(), cur.getMonth() + delta, 1));

  function commit(next: DateRange) {
    lastEmit.current = next;
    onChange(next);
  }

  // Commit a maxDays-clamped range, and — if it actually got reeled in —
  // surface that to the caller (print-11: a clamp used to happen silently).
  function commitClamped(next: DateRange & { clamped: boolean }) {
    const { clamped, ...range } = next;
    commit(range);
    if (clamped) onClamped?.(maxDays);
  }

  function pick(date: Date, shiftKey: boolean) {
    const key = toDateKey(date);
    if (shiftKey) {
      // Quick path: extend straight from the current start.
      commitClamped(rangeFromAnchor(value.start, key, maxDays));
      setPending(null);
      return;
    }
    if (pending === null) {
      // First tap: select the day and arm the end tap (works on touch + keyboard).
      setPending(key);
      commit({ start: key, end: key });
    } else {
      // Second tap: close the range from the pending start to this day.
      commitClamped(rangeFromAnchor(pending, key, maxDays));
      setPending(null);
    }
  }

  const { start, end } = value;

  return (
    <div className="cal-mini cal-mini--range">
      <div className="cal-mini__head">
        <span className="cal-mini__label">{monthLabel}</span>
        <div className="cal-mini__nav">
          <button
            type="button"
            className="cal-mini__navbtn"
            onClick={() => stepMonth(-1)}
            aria-label="Previous month"
            title="Previous month"
          >
            <CampIcon.ChevronLeft />
          </button>
          <button
            type="button"
            className="cal-mini__navbtn"
            onClick={() => stepMonth(1)}
            aria-label="Next month"
            title="Next month"
          >
            <CampIcon.ChevronRight />
          </button>
        </div>
      </div>
      <div className="cal-mini__grid" role="grid" aria-label={"Pick a date range — " + monthLabel}>
        <div className="cal-mini__row cal-mini__dow" role="row">
          {weekdays.map((w, i) => (
            <span key={i} className="cal-mini__dowcell" role="columnheader" aria-label={w}>
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="cal-mini__row" role="row">
            {week.map((date) => {
              const key = toDateKey(date);
              const isToday = key === today;
              const isOut = date.getMonth() !== cursorMonth;
              const inRange = key >= start && key <= end;
              // Round only the ends of a contiguous selected run so it reads as
              // one band even when it wraps a mini row.
              const prevKey = toDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));
              const nextKey = toDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
              const bandStart = inRange && (prevKey < start || prevKey > end);
              const bandEnd = inRange && (nextKey < start || nextKey > end);
              const cls =
                "cal-mini__day" +
                (isOut ? " is-out" : "") +
                (isToday ? " is-today" : "") +
                (inRange ? " is-inview" : "") +
                (bandStart ? " is-band-start" : "") +
                (bandEnd ? " is-band-end" : "");
              return (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  role="gridcell"
                  aria-current={isToday ? "date" : undefined}
                  aria-pressed={inRange}
                  aria-label={date.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  onClick={(event) => pick(date, event.shiftKey)}
                >
                  <span className="cal-mini__num">{date.getDate()}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {/* Guidance only while mid-selection (a start is set, waiting for the end) —
          the resting instruction was permanent clutter; picking a range is
          discoverable (click a day, click another) and the readout confirms it. */}
      {pending && <p className="cal-mini__hint">Now tap the last day of your range.</p>}
    </div>
  );
}
