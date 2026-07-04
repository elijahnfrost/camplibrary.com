// Camp Library — pure geometry for the Print tab's blocked-out "timeline" view.
//
// The timeline lays each day out like a Google-Calendar day view: a fixed time
// window down the page, with every event drawn as a block whose height tracks
// its duration and whose horizontal lane is split when events overlap. All the
// math is unit-free (fractions of the window) so the renderer can size the grid
// in physical inches for print while this stays React-free and unit-testable.

import { DAY_START_MIN, DAY_END_MIN, effectiveWindow, MINUTES_PER_DAY } from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { ScheduleDay } from "@/lib/print/schedule";
import type { DocDensity } from "@/lib/print/options";

export interface DayWindow {
  startMin: number;
  endMin: number;
}

// print-6 merged the old timeline-only "Spacing" control into the single
// doc-wide "Density" field (DocDensity). The timeline grid's per-hour row
// height still needs its own three-tier mapping (inches, not the --pd-pad-scale
// multiplier the rest of the doc uses) — this is that mapping, keyed by the
// SAME tight/regular/airy values the rest of the document reads. Tier names
// carried over 1:1 from the old TimelineDensity: tight↔compact, regular↔cozy,
// airy↔roomy. These are the single source of truth for both the rendered grid
// height AND the does-it-fit check, so the two can never disagree.
export const TIMELINE_ROW_IN: Record<DocDensity, number> = {
  tight: 0.46,
  regular: 0.62,
  airy: 0.8,
};

// Fixed vertical costs of a day, added to the grid height for the fit check.
export const TIMELINE_DAY_HEADER_IN = 0.46; // day heading + a little air
export const TIMELINE_ALLDAY_IN = 0.42; // the all-day strip, when a day has one

// How much of a letter page (11in tall, 0.45in margins → 10.1in printable) a
// single day's timeline may occupy before it can no longer fit on one page.
// Held a touch under the true 10.1in so a day never butts the very edge and so
// the cover can share the first page.
export const TIMELINE_PAGE_BUDGET_IN = 9.3;

// The window a timeline spans: the camp's default day (8:00–18:00) widened — to
// the hour — to encompass any event that starts earlier or ends later, so the
// axis always shows real clock hours and no block is clipped.
export function timelineWindow(events: CalendarEvent[]): DayWindow {
  const timed = events.filter((event) => !event.allDay);
  const win = effectiveWindow(timed, { startMin: DAY_START_MIN, endMin: DAY_END_MIN });
  // Guard against a degenerate window (shouldn't happen given the base, but keep
  // span strictly positive so fraction math never divides by zero).
  if (win.endMin <= win.startMin) return { startMin: DAY_START_MIN, endMin: DAY_END_MIN };
  return win;
}

export interface TimelineBlock {
  event: CalendarEvent;
  /** Vertical offset from the top of the grid, as a 0–100 percentage. */
  topPct: number;
  /** Block height as a 0–100 percentage of the grid. */
  heightPct: number;
  /** This block's lane index within its overlap cluster (0-based). */
  col: number;
  /** Total lanes in this block's cluster (1 when nothing overlaps it). */
  cols: number;
}

export interface TimelineDay {
  date: string;
  allDay: CalendarEvent[];
  blocks: TimelineBlock[];
}

// Assign overlapping events to side-by-side lanes (interval partitioning). Events
// that transitively overlap form a "cluster"; every event in a cluster reports
// the same `cols` (the cluster's lane count) so their widths line up. Input must
// be timed events already sorted by start, then end.
function packLanes(events: CalendarEvent[]): Map<string, { col: number; cols: number }> {
  const out = new Map<string, { col: number; cols: number }>();
  let cluster: CalendarEvent[] = [];
  let clusterEnd = -1;
  // Per-lane "free at" minute; index = lane.
  let laneEnds: number[] = [];

  const flush = () => {
    const cols = laneEnds.length || 1;
    for (const event of cluster) {
      const existing = out.get(event.id);
      if (existing) existing.cols = cols;
    }
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const event of events) {
    if (cluster.length > 0 && event.startMin >= clusterEnd) {
      // No overlap with the running cluster — close it out and start fresh.
      flush();
    }
    // Place into the first lane that's free by this event's start; else open one.
    let col = laneEnds.findIndex((freeAt) => freeAt <= event.startMin);
    if (col === -1) {
      col = laneEnds.length;
      laneEnds.push(event.endMin);
    } else {
      laneEnds[col] = event.endMin;
    }
    out.set(event.id, { col, cols: 1 });
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.endMin);
  }
  if (cluster.length > 0) flush();
  return out;
}

// Lay out one window's worth of days into positioned blocks. Timed events are
// clipped to the window so a block can't render outside the grid; all-day events
// are kept aside for a dedicated strip.
export function buildTimelineDays(days: ScheduleDay[], win: DayWindow): TimelineDay[] {
  const span = win.endMin - win.startMin;
  return days.map((day) => {
    const allDay: CalendarEvent[] = [];
    const timed: CalendarEvent[] = [];
    for (const event of day.events) {
      if (event.allDay) allDay.push(event);
      else timed.push(event);
    }
    // Sort for stable lane packing (start, then longer-first as a tiebreak).
    const sorted = [...timed].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    const lanes = packLanes(sorted);

    const blocks: TimelineBlock[] = sorted.map((event) => {
      const top = Math.max(win.startMin, Math.min(event.startMin, win.endMin));
      const bottom = Math.max(win.startMin, Math.min(event.endMin, win.endMin));
      const lane = lanes.get(event.id) ?? { col: 0, cols: 1 };
      return {
        event,
        topPct: ((top - win.startMin) / span) * 100,
        heightPct: (Math.max(bottom - top, 0) / span) * 100,
        col: lane.col,
        cols: lane.cols,
      };
    });

    return { date: day.date, allDay, blocks };
  });
}

// The hour gridlines/labels for the axis: every whole hour from window start to
// end (inclusive), with its vertical position as a percentage.
export interface TimelineHour {
  min: number;
  topPct: number;
}

export function timelineHours(win: DayWindow): TimelineHour[] {
  const span = win.endMin - win.startMin;
  const out: TimelineHour[] = [];
  const first = Math.ceil(win.startMin / 60) * 60;
  for (let min = first; min <= win.endMin; min += 60) {
    if (min >= MINUTES_PER_DAY) break;
    out.push({ min, topPct: ((min - win.startMin) / span) * 100 });
  }
  return out;
}

// Inches a single day's timeline occupies, including its header and (optionally)
// an all-day strip — the basis for the fit check and the rendered grid height.
export function timelineGridHeightIn(win: DayWindow, density: DocDensity): number {
  const hours = (win.endMin - win.startMin) / 60;
  return hours * TIMELINE_ROW_IN[density];
}

export function timelineDayHeightIn(win: DayWindow, density: DocDensity, hasAllDay: boolean): number {
  return TIMELINE_DAY_HEADER_IN + (hasAllDay ? TIMELINE_ALLDAY_IN : 0) + timelineGridHeightIn(win, density);
}

export interface TimelineFit {
  fits: boolean;
  tallestIn: number;
  budgetIn: number;
}

// Whether every day's timeline fits on one page at this density. Returns the
// tallest day so the UI can explain by how much it's over.
export function timelineFit(days: TimelineDay[], win: DayWindow, density: DocDensity): TimelineFit {
  let tallestIn = 0;
  if (days.length === 0) {
    tallestIn = timelineDayHeightIn(win, density, false);
  }
  for (const day of days) {
    const h = timelineDayHeightIn(win, density, day.allDay.length > 0);
    if (h > tallestIn) tallestIn = h;
  }
  return { fits: tallestIn <= TIMELINE_PAGE_BUDGET_IN, tallestIn, budgetIn: TIMELINE_PAGE_BUDGET_IN };
}
