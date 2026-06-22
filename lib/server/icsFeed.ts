import ical, { ICalCalendarMethod } from "ical-generator";
import type { StoredCalendarEvent } from "./userData";

// Pure iCalendar (RFC 5545) builder for the subscribable feed. No DB, no auth —
// fully unit-testable. Times are FLOATING (no timezone): each event renders at
// the same wall-clock time in whatever zone the subscriber's calendar uses,
// matching how the app stores schedule time (local wall-clock, no tz) and
// sidestepping DST entirely.
//
// Floating-time gotcha: ical-generator formats a floating event from the JS
// Date's UTC getters, NOT its local getters. So to emit a wall clock of 10:00 we
// must construct the Date so its UTC components are 10:00 — i.e. Date.UTC(...).
// Building with new Date(y, m, d, h, ...) would leak the server's timezone
// offset into the output. (Verified empirically against ical-generator 6.x.)

export type CalendarFeedInput = {
  /** X-WR-CALNAME / NAME — e.g. the camp name or "Camp schedule". */
  calendarName: string;
  /** Absolute https URL of this feed, for SOURCE/URL (self-reference). */
  feedUrl: string;
  /** App origin (no trailing slash needed), for building run-sheet deep links. */
  appBaseUrl: string;
  /** The feed's secret token, used to build token-gated run-sheet links. */
  feedToken: string;
  events: StoredCalendarEvent[];
  /** Optional LOCATION applied to every event (the camp name). */
  campName?: string | null;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// A floating timestamp: wall-clock (date + minute-of-day) packed into UTC
// components so ical-generator emits it verbatim (see the gotcha above).
function floatingAt(dateKey: string, minuteOfDay: number): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0));
}

// Date-only anchor for all-day events.
function dayAt(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function runSheetUrl(appBaseUrl: string, feedToken: string, activityId: string): string {
  const base = appBaseUrl.replace(/\/+$/, "");
  return `${base}/run/${encodeURIComponent(feedToken)}/${encodeURIComponent(activityId)}`;
}

// SEQUENCE must be a non-negative int that increases on every edit so clients
// re-render rather than ignore an update. The event's updatedAt (epoch seconds)
// gives exactly that.
function sequenceFromUpdatedAt(updatedAt: string): number {
  const ms = Date.parse(updatedAt);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
}

export function buildCalendarFeed(input: CalendarFeedInput): string {
  const cal = ical({
    name: input.calendarName,
    prodId: { company: "Camp Library", product: "calendar-feed", language: "EN" },
    method: ICalCalendarMethod.PUBLISH,
    ttl: 3600, // → REFRESH-INTERVAL + X-PUBLISHED-TTL ≈ hourly re-poll ("live").
    url: input.feedUrl,
    source: input.feedUrl,
  });

  const campLocation = input.campName?.trim() || undefined;

  for (const event of input.events) {
    if (!DATE_KEY_PATTERN.test(event.date)) continue; // defensive: skip malformed rows.

    // A per-event location (gym, field…) wins over the camp-wide fallback so
    // subscribers see where each block actually happens.
    const eventLocation =
      (typeof event.location === "string" && event.location.trim()) || campLocation;

    const timed =
      typeof event.startMin === "number" &&
      typeof event.endMin === "number" &&
      event.endMin > event.startMin;

    const link =
      event.activityId != null && event.activityId !== ""
        ? runSheetUrl(input.appBaseUrl, input.feedToken, event.activityId)
        : null;

    cal.createEvent({
      id: `${event.id}@camplibrary`,
      sequence: sequenceFromUpdatedAt(event.updatedAt),
      summary: event.title.trim() || "Untitled",
      ...(timed
        ? {
            start: floatingAt(event.date, event.startMin as number),
            end: floatingAt(event.date, event.endMin as number),
            floating: true,
          }
        : { start: dayAt(event.date), allDay: true }),
      ...(link ? { url: link, description: `Run sheet: ${link}` } : {}),
      ...(eventLocation ? { location: eventLocation } : {}),
    });
  }

  return cal.toString();
}
