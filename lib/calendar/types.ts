// The calendar's event model. Backend-facing and library-agnostic: dates are
// local DateKeys ("YYYY-MM-DD") and times are minutes from local midnight —
// camp is a single-timezone, wall-clock domain, so this avoids UTC/DST drift
// and maps cleanly onto the Postgres date + integer columns. FullCalendar
// Date objects are converted at the component boundary (lib/calendar/adapter).

import { normalizeHexColor } from "../color";
import { normalizeRecurrence, type RecurrenceRule } from "./recurrence";

export type DateKey = string;

export type CalendarEventKind = "activity" | "custom";

export interface CalendarEvent {
  id: string; // crypto.randomUUID()
  date: DateKey;
  startMin: number; // minutes from local midnight; 0 when allDay
  endMin: number; // exclusive; > startMin for timed events
  kind: CalendarEventKind;
  title: string; // denormalized activity title for chips/cards
  activityId?: string;
  campId?: string; // which camp this event belongs to; undefined = unscoped
  allDay?: boolean;
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
function normalizeLocations(value: Record<string, unknown>): string[] {
  const raw = Array.isArray(value.locations)
    ? value.locations
    : typeof value.location === "string"
      ? [value.location]
      : [];
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
      value.startMin >= value.endMin
    ) {
      return null;
    }
    startMin = value.startMin;
    endMin = value.endMin;
  }

  const activityId = typeof value.activityId === "string" && value.activityId ? value.activityId : undefined;
  const campId = typeof value.campId === "string" && value.campId ? value.campId : undefined;
  const event: CalendarEvent = {
    id: value.id,
    date: value.date,
    startMin,
    endMin,
    kind: value.kind === "activity" && activityId ? "activity" : "custom",
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
  // Recurrence rides in the payload; this normalizer rebuilds a clean object, so
  // the series fields must be re-attached or they'd be stripped on every read /
  // optimistic write. A seriesId only means something with a parseable rule.
  const recurrence = normalizeRecurrence(value.recurrence);
  if (recurrence && typeof value.seriesId === "string" && value.seriesId) {
    event.seriesId = value.seriesId;
    event.recurrence = recurrence;
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
