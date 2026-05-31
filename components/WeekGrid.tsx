"use client";

import type { CSSProperties } from "react";
import type { Activity, DaySchedule, ScheduleBlock } from "@/lib/types";
import { activityMeta, categoryTint, DAYS } from "@/lib/data";
import {
  blockEndMin,
  blockStartMin,
  formatRange,
  hourMarks,
  MAX_COLS_WEEK,
  minutesToCamp,
  TOTAL_MIN,
  ZOOM_LEVELS,
} from "@/lib/scheduleTime";
import { layoutEvents, pct, type LaidInput } from "@/lib/layoutEvents";
import { CAT_LABEL } from "./EventComposer";

// Weekday columns shown in the desktop overview (Mon–Fri).
const WEEK_DAYS = [0, 1, 2, 3, 4];

// Read-only 5-column run sheet on a shared time axis. Activity blocks open
// directions/details; labels stay inert and day headers only select a day.
export function WeekGrid({
  weekBlocks,
  byId,
  dayIndex,
  zoomIdx,
  hourPx,
  onSelectDay,
  onOpenBlock,
}: {
  weekBlocks: Record<number, DaySchedule>;
  byId: Record<string, Activity>;
  dayIndex: number;
  zoomIdx: number;
  hourPx?: string;
  onSelectDay: (day: number) => void;
  onOpenBlock: (day: number, block: ScheduleBlock) => void;
}) {
  const marks = hourMarks();
  const style = {
    "--hour-px": hourPx || ZOOM_LEVELS[zoomIdx] + "px",
    "--day-hours": TOTAL_MIN / 60,
  } as CSSProperties;

  return (
    <div className="cal-week" style={style}>
      <div className="cal-week__corner" aria-hidden="true" />
      {WEEK_DAYS.map((day) => {
        const planned = (weekBlocks[day] || []).filter(
          (block) => block.kind === "activity" && block.activityId
        ).length;
        return (
          <button
            type="button"
            key={"head-" + day}
            className={"cal-week__dayhead" + (day === dayIndex ? " is-active" : "")}
            onClick={() => onSelectDay(day)}
            aria-label={"Show " + DAYS[day] + " in the run sheet"}
          >
            <span>{DAYS[day].slice(0, 3)}</span>
            <strong>{day + 1}</strong>
            <small>{planned || "–"}</small>
          </button>
        );
      })}

      <div className="cal-week__axis" aria-hidden="true">
        {marks.map((mark) => (
          <span key={mark.min} className="cal-axis__mark" style={{ top: pct(mark.min) + "%" }}>
            {mark.label}
          </span>
        ))}
      </div>

      {WEEK_DAYS.map((day) => {
        const dayBlocks = weekBlocks[day] || [];
        const items: LaidInput[] = dayBlocks.map((block) => ({
          block,
          startMin: blockStartMin(block),
          endMin: blockEndMin(block),
        }));
        const positioned = layoutEvents(items, MAX_COLS_WEEK);
        return (
          <div
            key={"col-" + day}
            className="cal-week__col"
            data-today={day === dayIndex ? "true" : undefined}
            aria-label={DAYS[day] + " schedule"}
          >
            {marks.map((mark) => (
              <span key={mark.min} className="cal-line" style={{ top: pct(mark.min) + "%" }} />
            ))}
            {positioned.map((item) => {
              const itemStyleBase: CSSProperties = {
                top: pct(item.startMin) + "%",
                height: "calc(" + ((item.endMin - item.startMin) / TOTAL_MIN) * 100 + "% - 3px)",
                left: "calc(" + (item.col / item.cols) * 100 + "% + 2px)",
                width: "calc(" + 100 / item.cols + "% - 4px)",
              };
              if (item.overflow) {
                const hiddenItems = item.hiddenItems || [];
                return (
                  <button
                    key={"more-" + item.startMin + "-" + item.col}
                    type="button"
                    className="week-event week-event--more"
                    style={itemStyleBase}
                    onClick={() => onSelectDay(day)}
                    aria-label={hiddenItems.length + " more on " + DAYS[day]}
                  >
                    +{hiddenItems.length}
                  </button>
                );
              }
              const block = item.block;
              if (!block) return null;
              const activity = block.activityId ? byId[block.activityId] : null;
              const isOpen = (block.fill === "open" || block.fill === "conditional") && !activity;
              const isCustom = block.kind === "label";
              const isShort = item.endMin - item.startMin <= 20;
              const canPreview = block.kind === "activity" && Boolean(activity);
              const name = activity
                ? activity.title
                : isOpen
                  ? "Choose a " + (block.category ? CAT_LABEL[block.category] : "activity")
                  : block.label;
              const tint = activity
                ? categoryTint(activity.type)
                : isOpen && block.category
                  ? categoryTint(block.category)
                  : undefined;
              const itemStyle = tint ? ({ ...itemStyleBase, "--cat": tint } as CSSProperties) : itemStyleBase;
              const className =
                "week-event" +
                (isOpen ? " week-event--open" : isCustom ? " week-event--custom" : " week-event--activity") +
                (isShort ? " week-event--short" : "") +
                (!canPreview ? " week-event--locked" : "");
              const content = (
                <>
                  <span className="week-event__time">{minutesToCamp(item.startMin)}</span>
                  <span className="week-event__title">{name}</span>
                </>
              );
              return canPreview ? (
                <button
                  key={block.id}
                  type="button"
                  className={className}
                  style={itemStyle}
                  onClick={() => onOpenBlock(day, block)}
                  aria-label={
                    "View " + name + ", " + formatRange(item.startMin, item.endMin) + ", " + DAYS[day]
                  }
                  title={name + " · " + (activity ? activityMeta(activity) : "Activity block")}
                >
                  {content}
                </button>
              ) : (
                <div
                  key={block.id}
                  className={className}
                  style={itemStyle}
                  aria-label={name + ", " + formatRange(item.startMin, item.endMin) + ", " + DAYS[day]}
                  title={name + " · Schedule note"}
                >
                  {content}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
