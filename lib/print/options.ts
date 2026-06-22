// Camp Library — calendar print options.
//
// The Print tab prints a date RANGE of the schedule with modular detail. Format
// preferences (color, style, detail level, what to include) persist as a local
// view preference — the same pattern as the stored calendar view / camp hours,
// so they are NOT a synced user-doc and never touch the API allowlist. The
// chosen date range and camp live in component state (a stale persisted range
// would be more confusing than helpful), so only the FORMAT half persists.

import type { DateKey } from "@/lib/calendar/types";
import type { StorageValidator } from "@/lib/store";

// How color is emitted. "color" uses the earthy category/theme tints (with
// print-color-adjust: exact so the ink actually lands); "mono" is the classic
// black-on-white, toner-friendly sheet.
export type PrintColor = "color" | "mono";

// "styled" is the designed paper (script title, fact grids, rules); "plain" is
// a stripped, text-first layout for quick reference / photocopies / faxing.
export type PrintStyle = "styled" | "plain";

// Per-event richness in the schedule grid.
//   times   — time + title only (a wall schedule)
//   summary — + key facts (ages/group/place/duration/energy) + blurb
//   tldr    — + a short run-sheet summary (steps, safety, materials)
export type ScheduleDetail = "times" | "summary" | "tldr";

// How the day is laid out.
//   agenda   — a reading-order list of events (the classic schedule)
//   timeline — a blocked-out day grid where each event's height tracks its
//              duration, like a Google-Calendar day view
export type PrintLayout = "agenda" | "timeline";

// Vertical spacing of the timeline grid — trades pages for breathing room.
//   compact — tight rows; fits the most onto one page
//   cozy    — the balanced default
//   roomy   — tall rows with air around each block (may spill to a second page)
export type TimelineDensity = "compact" | "cozy" | "roomy";

// The format half — persisted as a local preference.
export interface PrintFormat {
  color: PrintColor;
  style: PrintStyle;
  // List of events vs. a blocked-out time grid.
  layout: PrintLayout;
  // Spacing of the timeline grid (only meaningful when layout === "timeline").
  timelineDensity: TimelineDensity;
  scheduleDetail: ScheduleDetail;
  // Append a full run sheet (the activity-book level of detail) for every
  // distinct activity scheduled in the range, after the schedule.
  appendRunSheets: boolean;
  includeAllDay: boolean;
  includeEmptyDays: boolean;
  // Start each day on its own page (a sheet per day to hand out).
  pageBreakPerDay: boolean;
  // A combined materials checklist across the whole range (a shopping list).
  materialsRollup: boolean;
  // Show the activity's theme (e.g. "Ocean Week") next to each event.
  showThemes: boolean;
}

// The full options object the document renders from: the persisted format plus
// the ephemeral range / camp / title chosen for this print.
export interface PrintOptions extends PrintFormat {
  start: DateKey;
  end: DateKey;
  campId: string | null; // null = every camp
  title: string; // optional custom cover title; "" falls back to the range label
  // Individually-picked activities to append a full run sheet for (additive to
  // `appendRunSheets`). Ephemeral, per-print — not persisted with the format.
  runSheetIds: string[];
}

export const DEFAULT_PRINT_FORMAT: PrintFormat = {
  color: "color",
  style: "styled",
  layout: "agenda",
  timelineDensity: "cozy",
  scheduleDetail: "summary",
  appendRunSheets: false,
  includeAllDay: true,
  includeEmptyDays: false,
  pageBreakPerDay: true,
  materialsRollup: false,
  showThemes: true,
};

const COLORS: PrintColor[] = ["color", "mono"];
const STYLES: PrintStyle[] = ["styled", "plain"];
const LAYOUTS: PrintLayout[] = ["agenda", "timeline"];
const DENSITIES: TimelineDensity[] = ["compact", "cozy", "roomy"];
const DETAILS: ScheduleDetail[] = ["times", "summary", "tldr"];

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// Validate a persisted (localStorage) format blob into a complete PrintFormat,
// field by field, so a partial or tampered value can never strand the tab.
export const printFormatStorage: StorageValidator<PrintFormat> = (value, fallback) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
  const v = value as Record<string, unknown>;
  return {
    color: oneOf(v.color, COLORS, fallback.color),
    style: oneOf(v.style, STYLES, fallback.style),
    layout: oneOf(v.layout, LAYOUTS, fallback.layout),
    timelineDensity: oneOf(v.timelineDensity, DENSITIES, fallback.timelineDensity),
    scheduleDetail: oneOf(v.scheduleDetail, DETAILS, fallback.scheduleDetail),
    appendRunSheets: bool(v.appendRunSheets, fallback.appendRunSheets),
    includeAllDay: bool(v.includeAllDay, fallback.includeAllDay),
    includeEmptyDays: bool(v.includeEmptyDays, fallback.includeEmptyDays),
    pageBreakPerDay: bool(v.pageBreakPerDay, fallback.pageBreakPerDay),
    materialsRollup: bool(v.materialsRollup, fallback.materialsRollup),
    showThemes: bool(v.showThemes, fallback.showThemes),
  };
};
