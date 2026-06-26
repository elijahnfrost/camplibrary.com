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

// Doc-wide text size — drives the print scale's --pd-scale multiplier so the
// whole sheet grows/shrinks in lockstep. "regular" is the designed 1.0 baseline.
export type FontScale = "small" | "regular" | "large";

// Doc-wide spacing — drives --pd-pad-scale so the page paddings/gaps tighten or
// open up (independent of the timeline grid's own density).
export type DocDensity = "tight" | "regular" | "airy";

// The movable document sections, in print order. The cover (toggled separately
// by `showCover`) always leads; these three reorder beneath it. "schedule" is the
// day-by-day body; "rollup" the materials shopping list; "appendix" the appended
// run sheets. Stored as an order array so the rail can move a section up/down.
export type DocSection = "rollup" | "schedule" | "appendix";
export const DOC_SECTIONS: DocSection[] = ["rollup", "schedule", "appendix"];

// Map the font-scale / density choices to their print-scale multipliers. Kept
// here (next to the model) so the document and the controls agree on the numbers.
export const FONT_SCALE_VALUE: Record<FontScale, number> = {
  small: 0.9,
  regular: 1,
  large: 1.12,
};
export const DOC_DENSITY_VALUE: Record<DocDensity, number> = {
  tight: 0.82,
  regular: 1,
  airy: 1.25,
};

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
  // Print the title cover header. Off prints straight into the schedule.
  showCover: boolean;
  // Doc-wide text size + spacing (drive the print scale's --pd-scale /
  // --pd-pad-scale, so the whole sheet grows/tightens in lockstep).
  fontScale: FontScale;
  density: DocDensity;
  // A "Page N of M" footer on every printed page.
  pageNumbers: boolean;
  // The order of the movable document sections beneath the cover.
  sectionOrder: DocSection[];
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
  // Days EXCLUDED from this print (DateKeys). Ephemeral selection — a persisted
  // exclusion would silently drop days from a later, unrelated range.
  excludedDays: DateKey[];
  // Individual events EXCLUDED from this print (event ids). Ephemeral selection.
  excludedEventIds: string[];
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
  showCover: true,
  fontScale: "regular",
  density: "regular",
  pageNumbers: false,
  sectionOrder: DOC_SECTIONS,
};

const COLORS: PrintColor[] = ["color", "mono"];
const STYLES: PrintStyle[] = ["styled", "plain"];
const LAYOUTS: PrintLayout[] = ["agenda", "timeline"];
const DENSITIES: TimelineDensity[] = ["compact", "cozy", "roomy"];
const DETAILS: ScheduleDetail[] = ["times", "summary", "tldr"];
const FONT_SCALES: FontScale[] = ["small", "regular", "large"];
const DOC_DENSITIES: DocDensity[] = ["tight", "regular", "airy"];

// Coerce a persisted section-order blob into a complete, de-duplicated, in-range
// order: keep the listed sections (in their stored order), then append any that
// were missing (so a future new section can't be silently dropped).
function sectionOrder(value: unknown, fallback: DocSection[]): DocSection[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<DocSection>();
  const out: DocSection[] = [];
  for (const item of value) {
    if (typeof item === "string" && (DOC_SECTIONS as string[]).includes(item) && !seen.has(item as DocSection)) {
      seen.add(item as DocSection);
      out.push(item as DocSection);
    }
  }
  for (const section of DOC_SECTIONS) if (!seen.has(section)) out.push(section);
  return out;
}

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
    showCover: bool(v.showCover, fallback.showCover),
    fontScale: oneOf(v.fontScale, FONT_SCALES, fallback.fontScale),
    density: oneOf(v.density, DOC_DENSITIES, fallback.density),
    pageNumbers: bool(v.pageNumbers, fallback.pageNumbers),
    sectionOrder: sectionOrder(v.sectionOrder, fallback.sectionOrder),
  };
};
