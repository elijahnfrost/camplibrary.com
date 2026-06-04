import type { DaySchedule, Schedule, ScheduleBlock } from "./types";
import { blockEndMin, blockStartMin, DAY_END_MIN, DAY_START_MIN } from "./scheduleTime";

export type CurrentActivityResult =
  | { status: "loading" }
  | { status: "weekend"; minutes: number }
  | { status: "outside-hours"; dayIndex: number; minutes: number }
  | { status: "no-block"; dayIndex: number; minutes: number }
  | { status: "label"; dayIndex: number; minutes: number; block: ScheduleBlock }
  | { status: "open-slot"; dayIndex: number; minutes: number; block: ScheduleBlock }
  | { status: "activity"; dayIndex: number; minutes: number; block: ScheduleBlock; activityId: string };

export function localDayIndex(date: Date): number | null {
  const weekday = date.getDay();
  return weekday >= 1 && weekday <= 5 ? weekday - 1 : null;
}

export function localMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function orderedBlocks(blocks: DaySchedule | undefined): DaySchedule {
  return [...(blocks || [])].sort((a, b) => blockStartMin(a) - blockStartMin(b));
}

export function findActiveBlock(blocks: DaySchedule | undefined, minutes: number): ScheduleBlock | null {
  return orderedBlocks(blocks).find((block) => {
    const start = blockStartMin(block);
    const end = blockEndMin(block);
    return minutes >= start && minutes < end;
  }) ?? null;
}

export function currentActivityForSchedule(schedule: Schedule, date: Date): CurrentActivityResult {
  const dayIndex = localDayIndex(date);
  const minutes = localMinutes(date);
  if (dayIndex == null) return { status: "weekend", minutes };
  if (minutes < DAY_START_MIN || minutes >= DAY_END_MIN) {
    return { status: "outside-hours", dayIndex, minutes };
  }

  const block = findActiveBlock(schedule[dayIndex], minutes);
  if (!block) return { status: "no-block", dayIndex, minutes };
  if (block.kind === "label") return { status: "label", dayIndex, minutes, block };
  if (block.fill === "open" || block.fill === "conditional" || !block.activityId) {
    return { status: "open-slot", dayIndex, minutes, block };
  }
  return { status: "activity", dayIndex, minutes, block, activityId: block.activityId };
}

export function clipboardRunKey(dayIndex: number | undefined, blockId: string | undefined, activityId: string): string {
  if (dayIndex != null && blockId) return "day-" + dayIndex + ":" + blockId + ":" + activityId;
  return "activity:" + activityId;
}
