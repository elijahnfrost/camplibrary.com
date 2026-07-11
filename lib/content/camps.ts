// Camp Library — camps.
//
// A "camp" is a lightweight, switchable scheduling container (e.g. "Summer Day
// Camp 2026"). Camps own ONLY their calendar events — the Library catalog stays
// global and shared across every camp. An event belongs to a camp via an
// optional `campId` that rides in the event payload (zero DDL); the camp list
// itself is a synced user-doc. Single-camp users never see camp UI: the list
// starts empty and the calendar shows everything until the first camp is made.
//
// Each camp also carries its own viewing hours (drop-off → pickup), which set how
// far the calendar day is drawn. These used to be an age-keyed, localStorage-only
// model living apart from camps; folding them onto the camp object means hours
// sync (camps is a synced doc) and follow the active camp. Isomorphic — the
// validator runs on the client AND on untrusted server payloads, so no
// "use client" directive.

import { fromDateKey } from "../calendar/dates";
import { normalizeGuides, type GuideBand } from "../calendar/guides";
import { DAY_END_MIN, DAY_START_MIN, SNAP_MIN, snapMinutes, type DayWindow } from "../calendar/time";
import { isDateKey, type DateKey } from "../calendar/types";
import { nextPaletteTint } from "./themes";

// A weekday index (0 = Sunday … 6 = Saturday), matching Date.getDay().
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// The snap grid a camp offers for placement/editing. A whitelisted set (not any
// number) so a payload can't request a nonsensical grid; absent falls back to
// the app default SNAP_MIN. The UI threads this later; nothing else changes yet.
export type CampSnapMin = 5 | 10 | 15 | 30;
const CAMP_SNAP_MINS = new Set<number>([5, 10, 15, 30]);

export interface Camp {
  id: string;
  name: string;
  createdAt: number;
  /** Earliest visible minute from midnight — the camp's drop-off. */
  openMin: number;
  /** Latest visible minute from midnight — the camp's pickup. */
  closeMin: number;
  // Per-weekday hour overrides (0 = Sunday … 6 = Saturday). A DayWindow replaces
  // the base hours on that weekday; `null` means the camp is CLOSED that weekday.
  // Absent weekdays fall through to the base openMin/closeMin.
  weekdayHours?: Partial<Record<Weekday, DayWindow | null>>;
  // Per-date hour overrides (highest precedence). A DayWindow replaces the hours
  // on that exact date; `null` means CLOSED that date (a holiday). Absent dates
  // fall through to weekdayHours, then the base hours.
  dateHours?: Record<DateKey, DayWindow | null>;
  // The snap grid this camp offers (see CampSnapMin). Absent = app default.
  snapMin?: CampSnapMin;
  // This camp's own day-structure guidance bands (soft time frames drawn behind
  // the grid). Per-camp so each camp can shape its day differently. Absent means
  // the camp hasn't set its own yet — the UI inherits the legacy shared `guides`
  // doc as a display baseline until the first per-camp edit forks a copy here.
  guides?: GuideBand[];
}

export const MAX_CAMP_NAME = 60;

// The selectable range for the base open/close pickers — a generous camp day so
// the dropdowns stay short while covering every realistic drop-off and pickup.
export const EARLIEST_OPEN_MIN = 6 * 60; // 6:00 am
export const LATEST_CLOSE_MIN = 20 * 60; // 8:00 pm

// Date/weekday OVERRIDES get their own WIDER bounds than the base hours. The
// motivating case is a "late finale" that runs to 8:30 PM: the base 6:00–20:00
// clamp would silently destroy a 21:00 close, so an override may reach an early
// 5:00 am and a late 10:00 pm. The base openMin/closeMin keep the tighter clamp.
export const OVERRIDE_EARLIEST_OPEN_MIN = 5 * 60; // 5:00 am
export const OVERRIDE_LATEST_CLOSE_MIN = 22 * 60; // 10:00 pm

// Defensive caps so an untrusted payload can't carry unbounded per-day maps.
const MAX_DATE_HOURS = 120; // ~one summer of dated overrides/holidays
const MAX_WEEKDAY_HOURS = 7; // one entry per weekday, at most

// A new camp's hours: 7:30 am – 6:00 pm, the historical default camp day (the
// union the old age-keyed model produced out of the box).
export const DEFAULT_OPEN_MIN = 7 * 60 + 30;
export const DEFAULT_CLOSE_MIN = 18 * 60;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const snapClamp = (n: number, lo: number, hi: number): number => clamp(snapMinutes(n), lo, hi);

// Force a camp's base open/close onto the snap grid, inside the selectable range,
// with at least one slot between them (open strictly before close).
export function clampOpenClose(openMin: number, closeMin: number): { openMin: number; closeMin: number } {
  const open = snapClamp(openMin, EARLIEST_OPEN_MIN, LATEST_CLOSE_MIN - SNAP_MIN);
  let close = snapClamp(closeMin, EARLIEST_OPEN_MIN + SNAP_MIN, LATEST_CLOSE_MIN);
  if (close <= open) close = Math.min(LATEST_CLOSE_MIN, open + SNAP_MIN);
  return { openMin: open, closeMin: close };
}

// Force a date/weekday OVERRIDE window onto the snap grid inside the WIDER
// override bounds — so a legitimate late finale (e.g. a 20:30 pickup) survives
// where the base 6:00–20:00 clamp would silently crush it. Same open-before-close
// invariant as clampOpenClose, just against OVERRIDE_* bounds.
export function clampOverrideWindow(openMin: number, closeMin: number): DayWindow {
  const start = snapClamp(openMin, OVERRIDE_EARLIEST_OPEN_MIN, OVERRIDE_LATEST_CLOSE_MIN - SNAP_MIN);
  let end = snapClamp(closeMin, OVERRIDE_EARLIEST_OPEN_MIN + SNAP_MIN, OVERRIDE_LATEST_CLOSE_MIN);
  if (end <= start) end = Math.min(OVERRIDE_LATEST_CLOSE_MIN, start + SNAP_MIN);
  return { startMin: start, endMin: end };
}

// The snap grid a camp offers — its whitelisted snapMin, or the app default.
export function campSnapMin(camp: Camp | null | undefined): number {
  return camp?.snapMin ?? SNAP_MIN;
}

// camps-6: a leading identity swatch for camp rows in the manager, like Themes/
// Locations rows. Camps carry no color field of their own (a camp's "signature"
// color isn't otherwise used anywhere in the app, unlike a theme or a location),
// so rather than add a new persisted field this derives a STABLE tint from the
// camp's position in the (creation-ordered) list — the exact round-robin recipe
// themes already use — keyed by id so it survives reordering/insertion the same
// way a theme's tint would. Deterministic: the same camp always gets the same
// tint for a given roster, with no per-string hashing.
export function campTint(campId: string, camps: readonly Camp[]): string {
  const index = camps.findIndex((c) => c.id === campId);
  return nextPaletteTint(index < 0 ? camps.length : index);
}

// Move a camp's open time, pushing close out if the move would cross it.
export function withCampOpen(camp: Camp, openMin: number): Camp {
  const open = snapClamp(openMin, EARLIEST_OPEN_MIN, LATEST_CLOSE_MIN - SNAP_MIN);
  const closeMin = camp.closeMin <= open ? Math.min(LATEST_CLOSE_MIN, open + SNAP_MIN) : camp.closeMin;
  return { ...camp, openMin: open, closeMin };
}

// Move a camp's close time, pulling open in if the move would cross it.
export function withCampClose(camp: Camp, closeMin: number): Camp {
  const close = snapClamp(closeMin, EARLIEST_OPEN_MIN + SNAP_MIN, LATEST_CLOSE_MIN);
  const openMin = camp.openMin >= close ? Math.max(EARLIEST_OPEN_MIN, close - SNAP_MIN) : camp.openMin;
  return { ...camp, openMin, closeMin: close };
}

// The calendar's base window for an (optionally absent) active camp: the camp's
// own hours, or the classic 8:00–18:00 band when no camp is active. effectiveWindow
// only ever stretches this outward around events, so nothing clips.
export function campDayWindow(camp: Camp | null | undefined): DayWindow {
  if (!camp) return { startMin: DAY_START_MIN, endMin: DAY_END_MIN };
  return { startMin: camp.openMin, endMin: camp.closeMin };
}

// The window for one concrete DAY, honoring the override precedence:
//   dateHours[date]  (a dated override / holiday)
//     ?? weekdayHours[dow(date)]  (a recurring weekday shape)
//       ?? the base camp hours (campDayWindow).
// A `null` at either override layer means the camp is CLOSED that day, and that
// null propagates as null (a closed day) rather than falling through — an
// explicit "closed" must win over the base hours. With no active camp this is
// just the classic 8:00–18:00 band. Pure and deterministic (dow is wall-clock
// date math, no timezone drift).
export function resolveDayWindow(camp: Camp | null | undefined, date: DateKey): DayWindow | null {
  if (!camp) return campDayWindow(null);
  // A dated override wins outright, including an explicit `null` (holiday).
  if (camp.dateHours && Object.prototype.hasOwnProperty.call(camp.dateHours, date)) {
    return camp.dateHours[date];
  }
  // Then the weekday shape, again including an explicit `null` (closed weekday).
  if (camp.weekdayHours) {
    const dow = fromDateKey(date).getDay() as Weekday;
    if (Object.prototype.hasOwnProperty.call(camp.weekdayHours, dow)) {
      return camp.weekdayHours[dow] ?? null;
    }
  }
  return campDayWindow(camp);
}

// 15-minute clock options spanning the selectable range, for the open/close
// dropdowns (e.g. "7:30 am", "8:00 am", …). Imported lazily by the camp manager
// (which carries its own formatClock) to keep this module free of display code.
export function hourOptionMinutes(): number[] {
  const out: number[] = [];
  for (let m = EARLIEST_OPEN_MIN; m <= LATEST_CLOSE_MIN; m += SNAP_MIN) out.push(m);
  return out;
}

// Parse one override entry: a DayWindow (clamped to the wider override bounds)
// or an explicit `null` (closed). Returns `undefined` for anything malformed so
// the caller drops the key entirely.
function normalizeOverrideEntry(raw: unknown): DayWindow | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const w = raw as Record<string, unknown>;
  const start = w.startMin;
  const end = w.endMin;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return undefined;
  }
  return clampOverrideWindow(start, end);
}

// Per-weekday override map. Keys must be the weekday indices 0–6; entries are a
// clamped window or `null` (closed). Deterministic: iterated in ascending
// weekday order and capped. Returns `undefined` when empty so the key drops.
function normalizeWeekdayHours(
  raw: unknown
): Partial<Record<Weekday, DayWindow | null>> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<Weekday, DayWindow | null>> = {};
  let count = 0;
  for (let dow = 0 as Weekday; dow <= 6; dow = (dow + 1) as Weekday) {
    if (!Object.prototype.hasOwnProperty.call(src, String(dow))) continue;
    const entry = normalizeOverrideEntry(src[String(dow)]);
    if (entry === undefined) continue;
    out[dow] = entry;
    count += 1;
    if (count >= MAX_WEEKDAY_HOURS) break;
  }
  return count ? out : undefined;
}

// Per-date override map. Keys must be valid DateKeys; entries are a clamped
// window or `null` (holiday). Deterministic: iterated in sorted key order and
// capped. Returns `undefined` when empty so the key drops.
function normalizeDateHours(raw: unknown): Record<DateKey, DayWindow | null> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Record<DateKey, DayWindow | null> = {};
  let count = 0;
  for (const key of Object.keys(src).sort()) {
    if (!isDateKey(key)) continue;
    const entry = normalizeOverrideEntry(src[key]);
    if (entry === undefined) continue;
    out[key] = entry;
    count += 1;
    if (count >= MAX_DATE_HOURS) break;
  }
  return count ? out : undefined;
}

function normalizeCamp(value: unknown): Camp | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id.trim() : "";
  const name = typeof v.name === "string" ? v.name.trim().slice(0, MAX_CAMP_NAME) : "";
  if (!id || !name) return null;
  const createdAt =
    typeof v.createdAt === "number" && Number.isFinite(v.createdAt) ? v.createdAt : 0;
  // Hours default to the historical camp day when absent (older camps predate
  // per-camp hours) and are clamped onto the grid when present.
  const openRaw =
    typeof v.openMin === "number" && Number.isFinite(v.openMin) ? v.openMin : DEFAULT_OPEN_MIN;
  const closeRaw =
    typeof v.closeMin === "number" && Number.isFinite(v.closeMin) ? v.closeMin : DEFAULT_CLOSE_MIN;
  // Spread the raw record first so keys this build doesn't know round-trip instead
  // of being erased by a stale client's next whole-doc save. Every field this
  // build DOES know is overwritten (or delete-then-reattached, like the event
  // normalizer's optionals) after the spread, so junk can never shadow a value.
  const camp = { ...v, id, name, createdAt, ...clampOpenClose(openRaw, closeRaw) } as Camp;
  // Delete-then-reattach the validated optionals: drop whatever the spread carried
  // (possibly malformed), then set the clean value only when one exists.
  delete camp.weekdayHours;
  delete camp.dateHours;
  delete camp.snapMin;
  delete camp.guides;
  const weekdayHours = normalizeWeekdayHours(v.weekdayHours);
  if (weekdayHours) camp.weekdayHours = weekdayHours;
  const dateHours = normalizeDateHours(v.dateHours);
  if (dateHours) camp.dateHours = dateHours;
  if (typeof v.snapMin === "number" && CAMP_SNAP_MINS.has(v.snapMin)) {
    camp.snapMin = v.snapMin as CampSnapMin;
  }
  // Per-camp guides validate through the shared normalizeGuides (dedupe, caps,
  // window/weekday sanity). Only attach when the camp actually carries its own
  // set — an absent field means "inherit the shared baseline" (see the UI).
  const guides = normalizeGuides(v.guides);
  if (guides.length) camp.guides = guides;
  return camp;
}

// The camps doc: a list of unique-id camps in creation order. Deterministic so
// the client hydrate and the server store always agree.
export function normalizeCamps(value: unknown, fallback: Camp[]): Camp[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const out: Camp[] = [];
  for (const item of value) {
    const camp = normalizeCamp(item);
    if (camp && !seen.has(camp.id)) {
      seen.add(camp.id);
      out.push(camp);
    }
  }
  return out;
}

let campIdCounter = 0;

export function createCampId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "camp-" + crypto.randomUUID();
  }
  campIdCounter += 1;
  return "camp-" + Date.now().toString(36) + "-" + campIdCounter.toString(36);
}
