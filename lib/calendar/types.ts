// The calendar's event model. Backend-facing and library-agnostic: dates are
// local DateKeys ("YYYY-MM-DD") and times are minutes from local midnight —
// camp is a single-timezone, wall-clock domain, so this avoids UTC/DST drift
// and maps cleanly onto the Postgres date + integer columns. FullCalendar
// Date objects are converted at the component boundary (lib/calendar/adapter).

import { normalizeHexColor } from "../content/color";
import { normalizeRecurrence, type RecurrenceRule } from "./recurrence";

export type DateKey = string;

// Two real kinds. A "reminder" is no longer its own kind — it's any event with
// ZERO duration (endMin === startMin), folded into activity/custom and derived
// at render time. See the "stop" model in CalendarShell (events sharing a
// start time group into one marker; an all-zero-duration stop is a dot + count).
export type CalendarEventKind = "activity" | "custom";

// Longest a per-event note may be (a short nudge / detail, not an essay).
export const EVENT_NOTE_MAX_LENGTH = 280;

// A fallback plan attached to a placement (rainy-day backup, overflow option,
// open choice). Title is denormalized like event.title; activityId is optional
// so a custom (title-only) fallback works; locations, when present, replace the
// event's places on promote (a rain swap that still says "Fields" is a bug).
export type AlternateReason = "rain" | "overflow" | "choice";
export interface AlternateRef {
  title: string;
  activityId?: string;
  reason: AlternateReason;
  locations?: string[];
}
export const ALTERNATES_MAX = 3;
export const ALTERNATE_TITLE_MAX_LENGTH = 80;
const ALTERNATE_REASONS = new Set<string>(["rain", "overflow", "choice"]);

// Per-placement material substitution map: required catalog id → replacement
// label ("" = skipped for this placement). Bounded so an untrusted payload
// can't carry unbounded entries.
export const MATERIAL_SUBS_MAX = 16;
const MATERIAL_SUB_KEY_MAX_LENGTH = 80;
const MATERIAL_SUB_LABEL_MAX_LENGTH = 80;

const LINK_ID_MAX_LENGTH = 64;
const HEADCOUNT_MAX = 999;

// Event fields a this-scoped or bulk edit may durably override on a series
// member (regeneration then preserves them). Anything else appearing in a
// stored `custom` list is dropped at this boundary.
const CUSTOMIZABLE_FIELDS = new Set([
  "date",
  "startMin",
  "endMin",
  "allDay",
  "title",
  "activityId",
  "kind",
  "color",
  "locations",
  "note",
  "campId",
  "pinned",
  "alternates",
  "materialSubs",
  "linkId",
  "headcount",
]);

export interface CalendarEvent {
  id: string; // crypto.randomUUID()
  date: DateKey;
  startMin: number; // minutes from local midnight; 0 when allDay
  endMin: number; // exclusive for timed events; EQUAL to startMin for a 0-min reminder
  kind: CalendarEventKind;
  title: string; // denormalized activity title for chips/cards
  activityId?: string;
  campId?: string; // which camp this event belongs to; undefined = unscoped
  allDay?: boolean;
  // A short free-text note carried by any event (the nudge text for a reminder,
  // or a detail line on a custom block like "check allergies"). Optional, trimmed
  // and length-clamped at the boundary; rides the JSONB payload, so no DDL.
  note?: string;
  // Recurring events are stored as materialized occurrences (see
  // lib/calendar/recurrence): every occurrence in a series shares one seriesId
  // and carries the same rule, so any one of them can describe and edit the
  // whole series. Absent on plain one-off events.
  seriesId?: string;
  recurrence?: RecurrenceRule;
  // Per-placement color override (validated hex). Absent = inherit the
  // activity's color, which itself falls back to the category tint — resolved
  // lazily by effectiveEventColor (lib/data), so untouched events "start" at
  // their tag color with no backfill. Clearing it falls back to the tag color.
  color?: string;
  // Where this placement happens — one or more places picked per event from a
  // fixed set (gym, classroom, kitchen…). Absent/empty = unstated. Each entry is
  // trimmed/length-clamped and the list bounded here so an untrusted payload
  // can't carry unbounded strings.
  locations?: string[];
  // A pinned event (lunch, pool time, bus pickup) holds its position when a
  // planned operation (day shift) moves the rest of the day. It guards PLANNED
  // operations only — direct drag/resize always wins; it is not a lock.
  pinned?: boolean;
  // Series-member durability: which fields a this-scoped or bulk edit overrode
  // (series regeneration preserves them), and the rule slot this row occupies
  // (an RFC 5545 RECURRENCE-ID analog) once a this-edit moves its date. Only
  // meaningful alongside a surviving seriesId + parseable rule.
  custom?: string[];
  origDate?: DateKey;
  // Same-day linked runs ("split days"): legs of one logical unit share a linkId.
  linkId?: string;
  // Fallback plans for this placement. ABSENT = inherit the activity's default
  // alternates; PRESENT — including an empty list — is authoritative here, so
  // [] must survive the round-trip (it means "no backups on this placement").
  alternates?: AlternateRef[];
  // LEGACY — the per-placement Swap/Skip UI was removed (2026-07-03 materials
  // rework); no surface reads or writes this any more. The field stays
  // allowlisted so stored events keep validating and round-tripping losslessly;
  // do not repurpose the key.
  materialSubs?: Record<string, string>;
  // Reserved for capacity checks: planned/actual headcount. UI ships later; the
  // field is allowlisted now so nothing strips it when it does.
  headcount?: { planned?: number; actual?: number };
  updatedAt: number; // epoch ms, last-write-wins
}

// The starter set of places a block can happen — the seed for the user-editable
// location vocabulary (lib/locations + the synced `locations` doc). Staff add,
// rename, and remove places from the location picker's "Manage locations…"
// screen; this list is just what a fresh camp starts with. Kept as the seed so
// the picker still has sensible places before anyone customizes it.
export const EVENT_LOCATION_OPTIONS = [
  "Gym",
  "Classroom",
  "Kitchen",
  "Playground",
  "Fields",
  "Pool",
  "Baseball pitch",
] as const;

export const EVENT_LOCATION_MAX_LENGTH = 80;
// Bound the per-event list so a malformed payload can't carry a huge array; the
// picker only ever offers a handful, but legacy free-text values ride along too.
const EVENT_LOCATIONS_MAX = 12;

// Join an event's places into one display string (card / popover / feed).
export function formatLocations(locations: readonly string[] | undefined): string {
  return locations && locations.length ? locations.join(", ") : "";
}

// Parse a per-event locations value from an untrusted payload (localStorage
// cache or API). Accepts the new `locations` array or a legacy single `location`
// string. Each entry is trimmed + length-clamped, blanks dropped, duplicates
// removed case-insensitively, and the list capped.
function normalizeLocationList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const place = item.trim().slice(0, EVENT_LOCATION_MAX_LENGTH);
    const key = place.toLowerCase();
    if (!place || seen.has(key)) continue;
    seen.add(key);
    out.push(place);
    if (out.length >= EVENT_LOCATIONS_MAX) break;
  }
  return out;
}

function normalizeLocations(value: Record<string, unknown>): string[] {
  const raw = Array.isArray(value.locations)
    ? value.locations
    : typeof value.location === "string"
      ? [value.location]
      : [];
  return normalizeLocationList(raw);
}

function normalizeAlternates(raw: unknown[]): AlternateRef[] {
  const out: AlternateRef[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    const title =
      typeof v.title === "string" ? v.title.trim().slice(0, ALTERNATE_TITLE_MAX_LENGTH) : "";
    if (!title) continue;
    const ref: AlternateRef = {
      title,
      reason:
        typeof v.reason === "string" && ALTERNATE_REASONS.has(v.reason)
          ? (v.reason as AlternateReason)
          : "rain",
    };
    if (typeof v.activityId === "string" && v.activityId) ref.activityId = v.activityId;
    const locations = normalizeLocationList(v.locations);
    if (locations.length) ref.locations = locations;
    out.push(ref);
    if (out.length >= ALTERNATES_MAX) break;
  }
  return out;
}

function normalizeMaterialSubs(raw: unknown): Record<string, string> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val !== "string") continue;
    const id = key.trim().slice(0, MATERIAL_SUB_KEY_MAX_LENGTH);
    if (!id) continue;
    // An empty replacement label is meaningful: "skipped for this placement".
    out[id] = val.trim().slice(0, MATERIAL_SUB_LABEL_MAX_LENGTH);
    count += 1;
    if (count >= MATERIAL_SUBS_MAX) break;
  }
  return count ? out : null;
}

function normalizeHeadcount(raw: unknown): { planned?: number; actual?: number } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const read = (x: unknown): number | undefined =>
    typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= HEADCOUNT_MAX ? x : undefined;
  const planned = read(v.planned);
  const actual = read(v.actual);
  if (planned === undefined && actual === undefined) return null;
  const out: { planned?: number; actual?: number } = {};
  if (planned !== undefined) out.planned = planned;
  if (actual !== undefined) out.actual = actual;
  return out;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUTES_PER_DAY = 1440;

export function isDateKey(value: unknown): value is DateKey {
  return typeof value === "string" && DATE_KEY_PATTERN.test(value);
}

// Parse an untrusted value (localStorage cache or API payload) into a
// CalendarEvent, returning null for anything malformed.
export function normalizeCalendarEvent(raw: unknown): CalendarEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  if (!isDateKey(value.date)) return null;

  const allDay = value.allDay === true;
  let startMin = 0;
  let endMin = 0;
  if (!allDay) {
    if (
      typeof value.startMin !== "number" ||
      typeof value.endMin !== "number" ||
      !Number.isInteger(value.startMin) ||
      !Number.isInteger(value.endMin) ||
      value.startMin < 0 ||
      value.endMin > MINUTES_PER_DAY ||
      // A 0-min event (reminder) is allowed: start === end. Only a NEGATIVE span
      // is malformed.
      value.startMin > value.endMin
    ) {
      return null;
    }
    startMin = value.startMin;
    endMin = value.endMin;
  }

  const activityId = typeof value.activityId === "string" && value.activityId ? value.activityId : undefined;
  const campId = typeof value.campId === "string" && value.campId ? value.campId : undefined;
  // An "activity" kind needs its activityId to be real; everything else (and a
  // broken activity ref, or the retired "reminder" kind) falls back to "custom".
  const kind: CalendarEventKind = value.kind === "activity" && activityId ? "activity" : "custom";
  const event: CalendarEvent = {
    id: value.id,
    date: value.date,
    startMin,
    endMin,
    kind,
    title: typeof value.title === "string" ? value.title : "",
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  };
  if (activityId) event.activityId = activityId;
  if (campId) event.campId = campId;
  if (allDay) event.allDay = true;
  // Per-item color rides in the payload; like the series fields, this clean
  // rebuild must re-attach it or it's stripped on every read / optimistic write.
  const color = normalizeHexColor(value.color);
  if (color) event.color = color;
  // Per-placement locations ride in the payload too; same clean-rebuild rule —
  // re-attach them or they're stripped on every read / optimistic write. Trim,
  // clamp, dedupe and bound at this boundary (see normalizeLocations).
  const locations = normalizeLocations(value);
  if (locations.length) event.locations = locations;
  // A short note rides in the payload too — same clean-rebuild rule: re-attach it
  // (trimmed + length-clamped) or it's stripped on every read / optimistic write.
  const note = typeof value.note === "string" ? value.note.trim().slice(0, EVENT_NOTE_MAX_LENGTH) : "";
  if (note) event.note = note;
  // The remaining payload-riding fields follow the same clean-rebuild rule: each
  // one must be explicitly re-attached here or it is stripped on every read and
  // every optimistic write (commitEvents re-normalizes upserts).
  if (value.pinned === true) event.pinned = true;
  const linkId =
    typeof value.linkId === "string" ? value.linkId.trim().slice(0, LINK_ID_MAX_LENGTH) : "";
  if (linkId) event.linkId = linkId;
  // Absent = inherit the activity's default alternates; a PRESENT list — even an
  // empty one — is authoritative for this placement, so [] must round-trip.
  if (Array.isArray(value.alternates)) event.alternates = normalizeAlternates(value.alternates);
  const materialSubs = normalizeMaterialSubs(value.materialSubs);
  if (materialSubs) event.materialSubs = materialSubs;
  const headcount = normalizeHeadcount(value.headcount);
  if (headcount) event.headcount = headcount;
  // Recurrence rides in the payload; this normalizer rebuilds a clean object, so
  // the series fields must be re-attached or they'd be stripped on every read /
  // optimistic write. A seriesId only means something with a parseable rule.
  const recurrence = normalizeRecurrence(value.recurrence);
  if (recurrence && typeof value.seriesId === "string" && value.seriesId) {
    event.seriesId = value.seriesId;
    event.recurrence = recurrence;
    // Durable-customization fields only mean something on a series member; they
    // are whitelist-filtered and deduped here, dropped with a broken rule.
    if (Array.isArray(value.custom)) {
      const custom = [
        ...new Set(
          value.custom.filter(
            (field): field is string => typeof field === "string" && CUSTOMIZABLE_FIELDS.has(field)
          )
        ),
      ];
      if (custom.length) event.custom = custom;
    }
    if (isDateKey(value.origDate)) event.origDate = value.origDate;
  }
  return event;
}

export function normalizeCalendarEventList(raw: unknown): Record<string, CalendarEvent> {
  const out: Record<string, CalendarEvent> = {};
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const event = normalizeCalendarEvent(item);
    if (event) out[event.id] = event;
  }
  return out;
}
