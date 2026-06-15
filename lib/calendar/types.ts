// The calendar's event model. Backend-facing and library-agnostic: dates are
// local DateKeys ("YYYY-MM-DD") and times are minutes from local midnight —
// camp is a single-timezone, wall-clock domain, so this avoids UTC/DST drift
// and maps cleanly onto the Postgres date + integer columns. FullCalendar
// Date objects are converted at the component boundary (lib/calendar/adapter).

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
  updatedAt: number; // epoch ms, last-write-wins
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
