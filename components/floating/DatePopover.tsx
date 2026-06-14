"use client";

import { useMemo, useRef, useState } from "react";
import { fromDateKey, toDateKey, todayKey } from "@/lib/calendar/dates";
import type { DateKey } from "@/lib/calendar/types";
import { CampIcon } from "../icons";
import { FloatingLayer } from "./FloatingLayer";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]; // week starts Monday, matching the calendar (firstDay={1})

// A custom, themed replacement for <input type="date">: a `.select`-styled
// trigger showing the chosen day, opening a month grid. All date math goes
// through the app's local DateKey helpers (no UTC/DST drift).
export function DatePopover({
  id,
  value,
  onChange,
  ariaLabel,
}: {
  id?: string;
  value: DateKey;
  onChange: (value: DateKey) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // The month currently shown in the grid (1st of that month).
  const [viewKey, setViewKey] = useState(value);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const today = todayKey();

  const triggerLabel = useMemo(() => {
    const d = fromDateKey(value);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }, [value]);

  const view = fromDateKey(viewKey);
  const monthLabel = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const year = view.getFullYear();
  const month = view.getMonth();

  // Build the grid: leading blanks so the 1st lands under its weekday (Mon=0).
  const cells = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const lead = (firstOfMonth.getDay() + 6) % 7; // JS Sun=0 → Mon-based offset
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (DateKey | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(toDateKey(new Date(year, month, d)));
    return out;
  }, [year, month]);

  function openGrid() {
    setViewKey(value);
    setOpen(true);
  }

  function shiftMonth(delta: number) {
    setViewKey(toDateKey(new Date(year, month + delta, 1)));
  }

  function pick(key: DateKey) {
    onChange(key);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="cdate">
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={"select cselect__trigger" + (open ? " is-open" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openGrid())}
      >
        <span className="cselect__value">{triggerLabel}</span>
        <CampIcon.Calendar />
      </button>
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={() => setOpen(false)}
          className="cdate__pop"
          role="dialog"
          ariaLabel={ariaLabel}
        >
          <div className="cdate__head">
            <button
              type="button"
              className="icon-btn cdate__nav"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              data-floating-first
            >
              <CampIcon.ChevronLeft />
            </button>
            <span className="cdate__month">{monthLabel}</span>
            <button
              type="button"
              className="icon-btn cdate__nav"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
            >
              <CampIcon.ChevronRight />
            </button>
          </div>
          <div className="cdate__weekdays" aria-hidden="true">
            {WEEKDAYS.map((w) => (
              <span key={w} className="cdate__weekday">
                {w}
              </span>
            ))}
          </div>
          <div className="cdate__grid" role="grid">
            {cells.map((key, i) =>
              key === null ? (
                <span key={"blank-" + i} className="cdate__blank" aria-hidden="true" />
              ) : (
                <button
                  key={key}
                  type="button"
                  className={
                    "cdate__day" +
                    (key === value ? " is-on" : "") +
                    (key === today ? " is-today" : "")
                  }
                  aria-pressed={key === value}
                  aria-current={key === today ? "date" : undefined}
                  onClick={() => pick(key)}
                >
                  {fromDateKey(key).getDate()}
                </button>
              )
            )}
          </div>
        </FloatingLayer>
      )}
    </div>
  );
}
