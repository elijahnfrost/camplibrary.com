import type { DaySchedule, Schedule, ScheduleBlock } from "./types";

function toActivityIdSet(validActivityIds: Iterable<string> | undefined): Set<string> | null {
  if (validActivityIds == null) return null;
  return validActivityIds instanceof Set ? validActivityIds : new Set(validActivityIds);
}

function clearStaleActivityRef(block: ScheduleBlock, validActivityIds: Set<string>): ScheduleBlock {
  if (block.kind !== "activity" || !block.activityId || validActivityIds.has(block.activityId)) {
    return block;
  }

  const { activityId: _activityId, rule: _rule, ...openBlock } = block;
  return { ...openBlock, fill: "open" };
}

export function normalizeScheduleActivityRefs(
  schedule: Schedule,
  validActivityIds: Iterable<string>
): Schedule {
  const valid = toActivityIdSet(validActivityIds) ?? new Set<string>();
  let changed = false;
  const out: Schedule = {};

  for (const [key, blocks] of Object.entries(schedule)) {
    const normalizedBlocks = blocks.map((block) => {
      const normalized = clearStaleActivityRef(block, valid);
      if (normalized !== block) changed = true;
      return normalized;
    });
    out[Number(key)] = normalizedBlocks;
  }

  return changed ? out : schedule;
}

export function hasPlannedActivity(blocks: DaySchedule, validActivityIds?: Iterable<string>): boolean {
  const valid = toActivityIdSet(validActivityIds);
  return blocks.some(
    (block) =>
      block.kind === "activity" &&
      typeof block.activityId === "string" &&
      block.activityId.length > 0 &&
      (valid == null || valid.has(block.activityId)),
  );
}
