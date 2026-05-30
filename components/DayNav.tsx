"use client";

import type { DaySchedule } from "@/lib/types";
import { DAYS } from "@/lib/data";

// Shared horizontal 7-day selector (the chip strip). Used by the Schedule
// overview (mobile agenda) and the Calendar workspace.
export function DayNav({
  dayIndex,
  weekBlocks,
  onSelectDay,
  className = "",
}: {
  dayIndex: number;
  weekBlocks: Record<number, DaySchedule>;
  onSelectDay: (index: number) => void;
  className?: string;
}) {
  return (
    <div className={"day-carousel cal-days" + (className ? " " + className : "")} aria-label="Week days">
      {DAYS.map((day, index) => {
        const planned = (weekBlocks[index] || []).filter(
          (block) => block.kind === "activity" && block.activityId
        ).length;
        return (
          <button
            type="button"
            key={day}
            className={"day-chip" + (index === dayIndex ? " is-active" : "")}
            onClick={() => onSelectDay(index)}
            aria-current={index === dayIndex ? "date" : undefined}
          >
            <span>{day.slice(0, 3)}</span>
            <strong>{index + 1}</strong>
            <small>{planned || "–"}</small>
          </button>
        );
      })}
    </div>
  );
}
