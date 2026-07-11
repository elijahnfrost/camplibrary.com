"use client";

import { CampIcon } from "../ui/icons";
import { clampNDays, NDAYS_MAX, NDAYS_MIN } from "@/lib/calendar/views";

// The "Days" control for the multi-day (Week) strip: a compact − n + stepper
// (2–9). It only renders while a multi-day view is active, so `value` is always a
// real day count; stepping switches to an N-day window (the caller snaps 7 back
// to the canonical Week).
export function DaysStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <span className="daysstepper">
      <button
        type="button"
        className="daysstepper__btn"
        onClick={() => onChange(clampNDays(value - 1))}
        disabled={value <= NDAYS_MIN}
        aria-label="Fewer days"
      >
        <CampIcon.Minus />
      </button>
      <span className="daysstepper__val">{value}</span>
      <button
        type="button"
        className="daysstepper__btn"
        onClick={() => onChange(clampNDays(value + 1))}
        disabled={value >= NDAYS_MAX}
        aria-label="More days"
      >
        <CampIcon.Plus />
      </button>
    </span>
  );
}
