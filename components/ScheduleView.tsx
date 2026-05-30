"use client";

import type { Activity, DaySchedule, Slot } from "@/lib/types";
import { DAYS, durLabel, SLOTS } from "@/lib/data";
import { CampIcon } from "./icons";
import { clickable } from "./primitives";

export function ScheduleView({
  dayIndex,
  onDayChange,
  dayMap,
  onOpenSlot,
  onRemoveSlot,
  onOpenActivity,
  byId,
}: {
  dayIndex: number;
  onDayChange: (d: number) => void;
  dayMap: DaySchedule;
  onOpenSlot: (s: Slot) => void;
  onRemoveSlot: (slotId: string) => void;
  onOpenActivity: (a: Activity) => void;
  byId: Record<string, Activity>;
}) {
  const filled = SLOTS.filter((s) => !s.meal && dayMap[s.id]).length;
  return (
    <div className="fadein">
      <div className="dayhead">
        <div>
          <div className="dayhead__title">
            <em>{DAYS[dayIndex]}</em>
          </div>
          <div className="dayhead__sub">
            Week 1 · {filled} {filled === 1 ? "activity" : "activities"} planned
          </div>
        </div>
        <div className="daynav">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onDayChange(-1)}
            aria-label="Previous day"
            disabled={dayIndex === 0}
          >
            <CampIcon.ChevronLeft />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onDayChange(1)}
            aria-label="Next day"
            disabled={dayIndex === DAYS.length - 1}
          >
            <CampIcon.ChevronRight />
          </button>
        </div>
      </div>

      <div className="timeline">
        {SLOTS.map((s) => {
          if (s.meal)
            return (
              <div className="slot" key={s.id}>
                <div className="slot__time" />
                <div className="slot__box slot__box--meal">{s.label}</div>
              </div>
            );
          const act = dayMap[s.id] ? byId[dayMap[s.id]] : null;
          return (
            <div className="slot" key={s.id}>
              <div className="slot__time">{s.time}</div>
              {act ? (
                <div className="slot__box slot__box--filled">
                  <div className="slot__act" {...clickable(() => onOpenActivity(act))}>
                    <div className="slot__act-title">{act.title}</div>
                    <div className="slot__act-meta">
                      {act.type} · {durLabel(act)} · {act.place}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onRemoveSlot(s.id)}
                    aria-label="Remove"
                  >
                    <CampIcon.Trash />
                  </button>
                </div>
              ) : (
                <div
                  className="slot__box slot__box--empty"
                  aria-label={"Add activity at " + s.time}
                  {...clickable(() => onOpenSlot(s))}
                >
                  <CampIcon.Plus />
                  <span>Add activity</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ height: 8 }} />
    </div>
  );
}
