// ============================================================
// Camp Library — CalendarShell pure helpers
//
// View/strip config + the typing/draft/fingerprint/storage validators the
// calendar shell relies on. Pure and side-effect-free (no React, no component
// state), so they live in lib and are unit-tested directly. Extracted verbatim
// from CalendarShell.tsx.
// ============================================================
import { clampNDays, isNDaysView, type ViewKey } from "@/lib/calendar/views";
import { MINUTES_PER_DAY, snapDurationMin } from "@/lib/calendar/time";
import { isDateKey, normalizeCalendarEvent, type CalendarEvent, type DateKey } from "@/lib/calendar/types";
import { todayKey } from "@/lib/calendar/dates";
import { isColorMode, type ColorMode } from "@/lib/content/data";

export const STRIP_FIRST_DAY = 1;

// The timed views (Day / Week / Number-of-days) are ONE continuous, day-aligned
// strip you scroll horizontally — fixed-width day columns, native momentum, and
// CSS scroll-snap that loosely aligns to the nearest day so a day is never left
// half cut off at the edge (the free equivalent of the premium scrollgrid's
// dayMinWidth). Day/Week/N just set the ZOOM: how many days are sized to fit the
// viewport (1 / 7 / N) — which then determines the day width. We render a wide
// strip (STRIP_DAYS) and re-anchor it as you scroll near either end so the scroll
// feels endless. Month stays its own grid.
export const STRIP_DAYS = 35;
// Re-anchor when the visible window comes within this many days of a strip edge,
// recentering the strip by this much so there's always runway to keep scrolling.
export const REANCHOR_MARGIN = 4;
export const REANCHOR_SHIFT = 14;
// A day column never narrows past this (so a 9-day zoom on a phone stays legible
// and simply overflows / scrolls instead of crushing the columns).
export const MIN_DAY_WIDTH = 84;

// Pinch-to-zoom for the timed grid's HOUR HEIGHT (the vertical analogue of the
// Day/Week/N horizontal day-width zoom). A trackpad/touch pinch — or ctrl+wheel —
// scales the base 15-min slot height via the --cal-slot-zoom CSS var (see
// calendar.css). 1 = default; above 1 stretches each hour taller for fine detail.
// SLOT_ZOOM_MAX caps the zoom-IN; the zoom-OUT minimum is DYNAMIC (computeMinZoom)
// — you can never shrink the day past the point where it fills the viewport, so the
// grid is always hard-blocked top-and-bottom with no blank space below the last
// hour. SLOT_ZOOM_FLOOR is only an absolute sanity bound for the stored value.
export const SLOT_ZOOM_MAX = 3;
export const SLOT_ZOOM_FLOOR = 0.2;
export const clampSlotZoom = (zoom: number) =>
  Math.min(SLOT_ZOOM_MAX, Math.max(SLOT_ZOOM_FLOOR, zoom));

export const CALENDAR_VIEWS = {
  timeGridStrip: {
    type: "timeGrid",
    duration: { days: STRIP_DAYS },
    dateAlignment: "day",
    dateIncrement: { days: 1 },
  },
};

// The FullCalendar view-type string for a ViewKey: every timed view is the one
// scrollable strip; only Month is its own grid.
export function fcType(view: ViewKey): string {
  return view === "dayGridMonth" ? "dayGridMonth" : "timeGridStrip";
}

// How many days the chosen view sizes to fit the viewport (the zoom level).
export function targetDaysFor(view: ViewKey): number {
  if (isNDaysView(view)) return clampNDays(view.n);
  if (view === "timeGridDay") return 1;
  return 7; // Week (Month doesn't use the strip)
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

// The end minute for a draft: 0 for all-day; EQUAL to start for a 0-min reminder
// (length 0, which renders as a dot marker, never a block); otherwise start + the
// snapped length, clamped to the end of the day.
export function endMinForDraft(startMin: number, durationMin: number, allDay: boolean): number {
  if (allDay) return 0;
  if (durationMin <= 0) return startMin;
  return Math.min(MINUTES_PER_DAY, startMin + snapDurationMin(durationMin));
}

// A key-order-independent JSON serializer (recurses into nested objects, keeps
// array order). Used for the escalation staleness fingerprint below.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

// A CANONICAL fingerprint of a stored row for the escalation staleness check:
// stableStringify of every field except `updatedAt` (the last-write-wins clock,
// which a re-commit always bumps). BOTH sides are re-normalized first, because the
// `expected` rows are the raw plan output while the live rows were rebuilt by
// normalizeCalendarEvent on commit (which may drop empty/absent fields and reorder
// keys) — passing both through the same normalizer makes the comparison apples-to-
// apples, so a value the this-commit wrote reads as unchanged and escalation stays
// enabled. A row that fails to normalize (shouldn't happen for a stored row)
// fingerprints as its raw self.
export function rowFingerprint(event: CalendarEvent): string {
  const normalized = normalizeCalendarEvent(event) ?? event;
  const { updatedAt: _updatedAt, ...rest } = normalized;
  return stableStringify(rest);
}

export const boolStorage = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

export const slotZoomStorage = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? clampSlotZoom(value) : fallback;

// Validate the stored "Color by" mode against the known ids (mirrors
// parseWeekStart/boolStorage) so a stale/garbage value falls back to "custom".
export const colorModeStorage = (value: unknown, fallback: ColorMode) =>
  isColorMode(value) ? value : fallback;

// The Rain-alert threshold (percent). 0 = off; 30/50/70 arm the rain-review lens
// when the day's precip probability meets it. A closed whitelist so a garbage
// stored value falls back cleanly (mirrors the other weather-pref validators).
export type RainThreshold = 0 | 30 | 50 | 70;
const RAIN_THRESHOLDS: readonly RainThreshold[] = [0, 30, 50, 70];
export const parseRainThreshold = (value: unknown, fallback: RainThreshold): RainThreshold =>
  typeof value === "number" && (RAIN_THRESHOLDS as readonly number[]).includes(value)
    ? (value as RainThreshold)
    : fallback;
export const RAIN_THRESHOLD_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Off" },
  { value: "30", label: "30%" },
  { value: "50", label: "50%" },
  { value: "70", label: "70%" },
];

// Validate the dismissed-Rain-Review list: keep only well-formed DateKeys that are
// still today-or-later (a stale past date is pruned so the list can't grow across a
// season). Deterministic per read; mirrors the other localStorage validators.
export const parseDismissedRainDays = (value: unknown, fallback: DateKey[]): DateKey[] => {
  if (!Array.isArray(value)) return fallback;
  const today = todayKey();
  return [...new Set(value.filter((v): v is DateKey => isDateKey(v) && v >= today))];
};
