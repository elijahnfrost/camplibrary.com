"use client";

import { useMemo } from "react";
import type { Activity, DaySchedule, ScheduleBlock } from "@/lib/types";
import { activityMeta, DAYS } from "@/lib/data";
import { blockEndMin, blockStartMin, formatRange } from "@/lib/scheduleTime";
import { CampIcon } from "./icons";
import { DayNav } from "./DayNav";
import { WeekGrid } from "./WeekGrid";

// Tab 1: the read-only run sheet. Activity blocks open directions/details;
// labels and breaks stay inert, and this surface never jumps into the planner.
export function ScheduleOverview({
  dayIndex,
  onSelectDay,
  weekBlocks,
  byId,
  zoomIdx,
  onOpenBlock,
}: {
  dayIndex: number;
  weekBlocks: Record<number, DaySchedule>;
  byId: Record<string, Activity>;
  zoomIdx: number;
  onSelectDay: (index: number) => void;
  onOpenBlock: (day: number, block: ScheduleBlock) => void;
}) {
  const dayBlocks: DaySchedule = useMemo(
    () => [...(weekBlocks[dayIndex] || [])].sort((a, b) => blockStartMin(a) - blockStartMin(b)),
    [dayIndex, weekBlocks]
  );

  return (
    <div className="planner planner--overview fadein">
      <div className="overview-toolbar">
        <DayNav dayIndex={dayIndex} weekBlocks={weekBlocks} onSelectDay={onSelectDay} className="overview-daynav" />
      </div>

      {/* Desktop: full week at a glance. */}
      <div className="overview-week">
        <WeekGrid
          weekBlocks={weekBlocks}
          byId={byId}
          dayIndex={dayIndex}
          zoomIdx={zoomIdx}
          hourPx="clamp(54px, 7dvh, 80px)"
          onSelectDay={onSelectDay}
          onOpenBlock={onOpenBlock}
        />
      </div>

      {/* Phone: a calm agenda list for the chosen day. */}
      <div className="overview-agenda" aria-label={DAYS[dayIndex] + " agenda"}>
        {dayBlocks.length ? (
          dayBlocks.map((block) => {
            const startMin = blockStartMin(block);
            const endMin = blockEndMin(block);
            const activity = block.activityId ? byId[block.activityId] : null;
            const name = activity ? activity.title : block.label;
            const canPreview = block.kind === "activity" && Boolean(activity);
            const className =
              "agenda-row" +
              (block.kind === "label" ? " agenda-row--custom" : "") +
              (!canPreview ? " agenda-row--locked" : "");
            const content = (
              <>
                <span className="agenda-row__time">{formatRange(startMin, endMin)}</span>
                <span className="agenda-row__main">
                  <span className="agenda-row__title">{name}</span>
                  {activity && <span className="agenda-row__meta">{activityMeta(activity)}</span>}
                </span>
                {canPreview && <CampIcon.ChevronRight />}
              </>
            );
            return canPreview ? (
              <button
                type="button"
                key={block.id}
                className={className}
                onClick={() => onOpenBlock(dayIndex, block)}
                aria-label={"View " + name + ", " + formatRange(startMin, endMin)}
              >
                {content}
              </button>
            ) : (
              <div key={block.id} className={className} aria-label={name + ", " + formatRange(startMin, endMin)}>
                {content}
              </div>
            );
          })
        ) : (
          <div className="cal-empty overview-empty">
            <CampIcon.Calendar />
            <p>Nothing planned for {DAYS[dayIndex]} yet.</p>
            <span>Use Planner to build the day.</span>
          </div>
        )}
      </div>
    </div>
  );
}
