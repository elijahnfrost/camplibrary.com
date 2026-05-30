// Camp Library — overlap layout for the calendar.
// Assigns side-by-side columns to events that share time, and (optionally) caps
// the number of visible columns by collapsing the tail of a busy overlap group
// into a single "+N more" chip.

import type { ScheduleBlock } from "./types";
import { DAY_END_MIN, DAY_START_MIN, TOTAL_MIN } from "./scheduleTime";

export type Laid = {
  startMin: number;
  endMin: number;
  block: ScheduleBlock | null;
  ghost?: boolean;
  dragging?: boolean;
  // Overflow chip: not a real block, stands in for `hiddenItems` it collapsed.
  overflow?: boolean;
  hiddenItems?: Laid[];
  col: number;
  cols: number;
};

export type LaidInput = Omit<Laid, "col" | "cols">;

function layoutEnd(item: Pick<Laid, "startMin" | "endMin">): number {
  return Math.min(DAY_END_MIN, item.endMin);
}

// Vertical position as a percentage of the visible day window. The pixel height
// the percentage resolves against is driven by the --hour-px zoom variable.
export function pct(min: number): number {
  const clamped = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, min));
  return ((clamped - DAY_START_MIN) / TOTAL_MIN) * 100;
}

// Greedy interval-graph colouring within each maximal overlap group, then an
// optional overflow pass. `maxCols` of 0 / Infinity means "never collapse".
export function layoutEvents(items: LaidInput[], maxCols = Infinity): Laid[] {
  const sorted = items
    .map((item) => ({
      ...item,
      startMin: Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, item.startMin)),
      endMin: Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, item.endMin)),
    }))
    .filter((item) => item.endMin > item.startMin)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Laid[] = [];
  let group: Laid[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    const colEnds: number[] = [];
    for (const item of group) {
      let placed = false;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= item.startMin) {
          item.col = c;
          colEnds[c] = layoutEnd(item);
          placed = true;
          break;
        }
      }
      if (!placed) {
        item.col = colEnds.length;
        colEnds.push(layoutEnd(item));
      }
    }

    const used = colEnds.length;
    // Never collapse while something in this group is being dragged or previewed —
    // the live item must stay visible under the pointer.
    const hasLive = group.some((item) => item.dragging || item.ghost);

    if (used > maxCols && maxCols >= 2 && !hasLive) {
      // Keep columns 0..maxCols-2 visible; collapse everything from the last
      // visible slot onward into chips occupying column maxCols-1. Hide only
      // items whose own interval is actually congested; bridge events should not
      // collapse unrelated later events in the same connected overlap group.
      const shouldHide = (item: Laid) =>
        item.col >= maxCols - 1 &&
        group.filter((other) => item.startMin < layoutEnd(other) && layoutEnd(item) > other.startMin).length > maxCols;
      const visible = group.filter((item) => !shouldHide(item));
      const hidden = group.filter(shouldHide).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
      visible.forEach((item) => (item.cols = maxCols));
      out.push(...visible);

      let cluster: Laid[] = [];
      let clusterEnd = -Infinity;
      const pushCluster = () => {
        if (!cluster.length) return;
        out.push({
          startMin: Math.min(...cluster.map((h) => h.startMin)),
          endMin: Math.max(...cluster.map((h) => h.endMin)),
          block: null,
          overflow: true,
          hiddenItems: cluster,
          col: maxCols - 1,
          cols: maxCols,
        });
        cluster = [];
        clusterEnd = -Infinity;
      };
      for (const item of hidden) {
        if (cluster.length && item.startMin >= clusterEnd) pushCluster();
        cluster.push(item);
        clusterEnd = Math.max(clusterEnd, item.endMin);
      }
      pushCluster();
    } else {
      group.forEach((item) => (item.cols = used));
      out.push(...group);
    }
    group = [];
  };

  for (const raw of sorted) {
    const item: Laid = { ...raw, col: 0, cols: 1 };
    if (group.length && item.startMin >= groupEnd) {
      flush();
      groupEnd = -Infinity;
    }
    group.push(item);
    groupEnd = Math.max(groupEnd, layoutEnd(item));
  }
  if (group.length) flush();
  return out;
}
