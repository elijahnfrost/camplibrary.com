"use client";

import { type CSSProperties } from "react";
import { type ViewKey } from "@/lib/calendar/views";

// The calendar's view switcher — a 3-segment seg-slide [Day | Week | Month], the
// exact control the Library uses for Shelf/Deck/Catalog, so the two views' top
// bars read as one design. Day/Week/N-days are all the same timed strip at a
// different day count, so any multi-day window (Week or an N-day count set from
// the sidebar's Days stepper) reads as "Week" — the active segment is always
// unambiguous, and the Days stepper carries the exact count.

const SEGMENTS: { id: "timeGridDay" | "timeGridWeek" | "dayGridMonth"; label: string }[] = [
  { id: "timeGridDay", label: "Day" },
  { id: "timeGridWeek", label: "Week" },
  { id: "dayGridMonth", label: "Month" },
];

export function ViewSwitch({ view, onView }: { view: ViewKey; onView: (v: ViewKey) => void }) {
  // Anything that isn't Day or Month is a multi-day strip → it lives under Week.
  const activeId =
    view === "timeGridDay" ? "timeGridDay" : view === "dayGridMonth" ? "dayGridMonth" : "timeGridWeek";
  const activeIndex = SEGMENTS.findIndex((s) => s.id === activeId);
  return (
    <div
      className="viewswitch seg-slide"
      role="group"
      aria-label="Calendar view"
      style={{ "--seg-n": SEGMENTS.length, "--seg-i": activeIndex } as CSSProperties}
    >
      {SEGMENTS.map((s) => {
        const on = s.id === activeId;
        return (
          <button
            type="button"
            key={s.id}
            className={on ? "is-active" : ""}
            aria-pressed={on}
            onClick={() => onView(s.id)}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
