"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { daySpan, startOfWeek, toDateKey } from "@/lib/calendar/dates";
import type { DateKey } from "@/lib/calendar/types";
import { CampIcon } from "../ui/icons";

// The sidebar mini-month: a Google/Apple-Calendar style overview that sits
// above the activity rail. It mirrors the main grid — today is circled, the
// days currently in the main view glow as a connected band, and days carrying
// events get a dot. Clicking a day navigates the main calendar (onPick); the
// chevrons page the mini month on their own (a peek ahead) without moving the
// main grid, and the mini resyncs to the main view whenever that view's month
// changes. The in-view band is suppressed for spans wider than ~a fortnight so
// Month view (whole month in view) doesn't paint the whole grid.
const BAND_MAX_SPAN = 10;

export function MiniMonth({
  anchorDate,
  viewStart,
  viewEnd,
  today,
  todayInView,
  eventDays,
  firstDay = 1,
  onPick,
  onToday,
}: {
  /** Reference date of the main view (its first visible day) — sets which month shows. */
  anchorDate: Date;
  /** The main view's visible range as DateKeys (end exclusive); null before first render. */
  viewStart: DateKey | null;
  viewEnd: DateKey | null;
  today: DateKey;
  /** True when today already sits in the main view's window — disables the Today jump. */
  todayInView: boolean;
  /** Days with at least one event in the active camp — drawn with a dot. */
  eventDays: Set<DateKey>;
  /** First weekday of the week (0 = Sunday, 1 = Monday). Matches the grid. */
  firstDay?: number;
  onPick: (date: Date) => void;
  /** Jump the main calendar back to today (the header pager's old home). */
  onToday: () => void;
}) {
  const anchorKey = anchorDate.getFullYear() + "-" + anchorDate.getMonth();
  const [monthCursor, setMonthCursor] = useState(
    () => new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
  );

  // Resync to the main view's month whenever it changes — but leave a manual
  // peek (chevron paging) alone until the main view actually moves months.
  const lastAnchorRef = useRef(anchorKey);
  useEffect(() => {
    if (lastAnchorRef.current === anchorKey) return;
    lastAnchorRef.current = anchorKey;
    setMonthCursor(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1));
  }, [anchorKey, anchorDate]);

  const weekdays = useMemo(() => {
    const base = startOfWeek(new Date(2024, 0, 7), firstDay); // any reference week
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
    });
  }, [firstDay]);

  // A stable 6-row grid (42 cells) so the panel height never jumps month to month.
  const weeks = useMemo(() => {
    const gridStart = startOfWeek(monthCursor, firstDay);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(d);
    }
    return Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  }, [monthCursor, firstDay]);

  const showBand =
    viewStart != null && viewEnd != null && daySpan(viewStart, viewEnd) <= BAND_MAX_SPAN;

  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const cursorMonth = monthCursor.getMonth();

  const stepMonth = (delta: number) =>
    setMonthCursor((cur) => new Date(cur.getFullYear(), cur.getMonth() + delta, 1));

  return (
    <div className="cal-mini">
      <div className="cal-mini__head">
        <span className="cal-mini__label">{monthLabel}</span>
        <div className="cal-mini__nav">
          {/* Today lives here now (moved off the header) — the minimap is the
              calendar's navigator, so its "jump back to today" sits with it. */}
          <button
            type="button"
            className="cal-mini__today"
            onClick={onToday}
            disabled={todayInView}
            title={todayInView ? "You're looking at today" : "Jump to today (t)"}
          >
            Today
          </button>
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
      <div className="cal-mini__grid" role="grid" aria-label={"Calendar — " + monthLabel}>
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
              const inView = showBand && key >= viewStart! && key < viewEnd!;
              // Round only the ends of a contiguous in-view run so it reads as
              // one band even when it wraps a row (a rolling week can straddle
              // two mini rows). Neighbours are the adjacent calendar days.
              const prevKey = toDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));
              const nextKey = toDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
              const bandStart = inView && (prevKey < viewStart! || prevKey >= viewEnd!);
              const bandEnd = inView && (nextKey < viewStart! || nextKey >= viewEnd!);
              const cls =
                "cal-mini__day" +
                (isOut ? " is-out" : "") +
                (isToday ? " is-today" : "") +
                (inView ? " is-inview" : "") +
                (bandStart ? " is-band-start" : "") +
                (bandEnd ? " is-band-end" : "");
              return (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  role="gridcell"
                  aria-current={isToday ? "date" : undefined}
                  aria-pressed={inView}
                  aria-label={date.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  onClick={() => onPick(date)}
                >
                  <span className="cal-mini__num">{date.getDate()}</span>
                  {eventDays.has(key) && <span className="cal-mini__dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
