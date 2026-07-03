// Camp Library — day-structure guide bands.
//
// A "guide band" is a soft, recurring time frame drawn behind the calendar grid
// — "Morning free play 9:00–10:00", "Lunch 12:00–12:45", "Rest hour" — to shape
// a day without being an event. Bands are NOT placements: they don't own
// materials, don't move on a day shift, and never become chips. The UI wave maps
// each expanded (band, date) hit onto a FullCalendar BACKGROUND event; this
// module holds only the pure data + validation, so it imports no FC types.
//
// A band recurs on chosen weekdays, optionally bounded by from/until dates, and
// may carry a mealKind so a "Lunch" band and its meal glyph read as one thing.
// Isomorphic: validators run on the client (hydrate) AND on untrusted server
// payloads, so no "use client" and no Date.now()/randomness in the validators.

import { addDays, daySpan, fromDateKey } from "./dates";
import { isDateKey, MEAL_KINDS, type DateKey, type MealKind } from "./types";

const MEAL_KIND_SET = new Set<string>(MEAL_KINDS);

export const GUIDE_LABEL_MAX = 60;
const MINUTES_PER_DAY = 1440;

// Defensive caps.
const MAX_BANDS = 20;
// A hard ceiling on expansion output so a wide range × many bands can't blow up
// (e.g. an accidental years-long query). ~1000 hits is far past any real season.
const MAX_EXPANDED_HITS = 1000;

export interface GuideBand {
  id: string;
  label: string;
  startMin: number;
  // Exclusive end. Must be strictly greater than startMin: a 0-length band is
  // invalid, and 0-min stays the reminder discriminator on real events — a band
  // is never a point in time.
  endMin: number;
  // Which weekdays this band recurs on (0 = Sunday … 6 = Saturday). Nonempty,
  // deduped, sorted ascending — an empty set would draw nothing.
  weekdays: number[];
  // Optional inclusive date bounds. `fromKey` = first date the band applies;
  // `untilKey` = last date (inclusive). Absent = unbounded on that side.
  fromKey?: DateKey;
  untilKey?: DateKey;
  // Optional meal tie-in, so a "Lunch" band and the meal glyph read as one.
  mealKind?: MealKind;
}

function normalizeWeekdays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 6) continue;
    seen.add(item);
  }
  return [...seen].sort((a, b) => a - b);
}

function normalizeGuideBand(raw: unknown): GuideBand | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id.trim() : "";
  const label = typeof v.label === "string" ? v.label.trim().slice(0, GUIDE_LABEL_MAX) : "";
  if (!id || !label) return null;

  const startMin = v.startMin;
  const endMin = v.endMin;
  if (
    typeof startMin !== "number" ||
    typeof endMin !== "number" ||
    !Number.isInteger(startMin) ||
    !Number.isInteger(endMin) ||
    startMin < 0 ||
    endMin > MINUTES_PER_DAY ||
    // Strictly positive length — a 0-length band is invalid (see GuideBand).
    endMin <= startMin
  ) {
    return null;
  }

  const weekdays = normalizeWeekdays(v.weekdays);
  if (!weekdays.length) return null;

  const band: GuideBand = { id, label, startMin, endMin, weekdays };
  if (isDateKey(v.fromKey)) band.fromKey = v.fromKey;
  if (isDateKey(v.untilKey)) band.untilKey = v.untilKey;
  if (typeof v.mealKind === "string" && MEAL_KIND_SET.has(v.mealKind)) {
    band.mealKind = v.mealKind as MealKind;
  }
  return band;
}

// The guides doc: a list of unique-id bands, capped. Deterministic so the client
// hydrate and the server store always agree on the same shape.
export function normalizeGuides(value: unknown): GuideBand[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: GuideBand[] = [];
  for (const item of value) {
    const band = normalizeGuideBand(item);
    if (band && !seen.has(band.id)) {
      seen.add(band.id);
      out.push(band);
      if (out.length >= MAX_BANDS) break;
    }
  }
  return out;
}

// Expand bands to every (band, date) hit inside [startKey, endKeyExclusive),
// honoring each band's weekdays and from/until bounds. Deterministic order:
// day-by-day ascending, then bands in their stored order. Capped defensively so
// an over-wide range can't produce an unbounded array. Pure — no FC types; the
// UI wave maps hits onto FullCalendar background events itself.
export function guideBandsForRange(
  bands: GuideBand[],
  startKey: DateKey,
  endKeyExclusive: DateKey
): Array<{ band: GuideBand; date: DateKey }> {
  const out: Array<{ band: GuideBand; date: DateKey }> = [];
  if (!isDateKey(startKey) || !isDateKey(endKeyExclusive)) return out;
  const span = daySpan(startKey, endKeyExclusive);
  if (span <= 0) return out;

  for (let i = 0; i < span; i += 1) {
    const date = addDays(startKey, i);
    const dow = fromDateKey(date).getDay();
    for (const band of bands) {
      if (!band.weekdays.includes(dow)) continue;
      if (band.fromKey && date < band.fromKey) continue;
      if (band.untilKey && date > band.untilKey) continue;
      out.push({ band, date });
      if (out.length >= MAX_EXPANDED_HITS) return out;
    }
  }
  return out;
}

let guideIdCounter = 0;

export function createGuideId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "guide-" + crypto.randomUUID();
  }
  guideIdCounter += 1;
  return "guide-" + Date.now().toString(36) + "-" + guideIdCounter.toString(36);
}
