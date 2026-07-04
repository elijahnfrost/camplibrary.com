import type { NextRequest } from "next/server";
import type { Camp } from "@/lib/camps";
import { addDays, todayKey } from "@/lib/calendar/dates";
import { resolveCalendarFeedToken } from "@/lib/server/calendarFeeds";
import { getBackendEnvStatus, getPublicEnv } from "@/lib/server/env";
import { buildCalendarFeed } from "@/lib/server/icsFeed";
import { getUserDocs, listCalendarEvents, type StoredCalendarEvent } from "@/lib/server/userData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public, token-gated .ics feed. NO session: a calendar client fetches this
// server-side with no cookies, so the unguessable token IS the credential. The
// route runs under clerkMiddleware (the /api/(.*) matcher) but never calls
// auth() — clerkMiddleware does not force a session.
//
// How far the feed reaches: events from 90 days ago through a year out. Bounded
// so the payload stays small; calendar apps don't need ancient history.
const PAST_WINDOW_DAYS = -90;
const FUTURE_WINDOW_DAYS = 365;

type RouteContext = { params: Promise<{ token: string }> };

function feedNotFound() {
  // Generic 404 for both unknown and revoked tokens — never reveal which.
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest, context: RouteContext) {
  // Unconfigured backend → 503 (a config state, not token-specific). A transient
  // DB error below is left to surface as 5xx so calendar clients retry rather
  // than treat the feed as gone.
  if (!getBackendEnvStatus().capabilities.database) {
    return new Response("Calendar feed unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const { token: rawParam } = await context.params;
  const token = rawParam.replace(/\.ics$/i, "");

  const resolved = await resolveCalendarFeedToken(token);
  if (!resolved) return feedNotFound();

  const from = addDays(todayKey(), PAST_WINDOW_DAYS);
  const to = addDays(todayKey(), FUTURE_WINDOW_DAYS);
  const [allEvents, docs] = await Promise.all([
    listCalendarEvents(resolved.clerkUserId, { from, to }),
    getUserDocs(resolved.clerkUserId),
  ]);

  const camps = (docs.camps as Camp[] | undefined) ?? [];
  const campIds = new Set(camps.map((c) => c.id));

  // Filter to the feed's camp PLUS unscoped events (no campId, or a campId whose
  // camp was deleted) — mirrors useCamps.filterEvents. A feed with no camp pin
  // (campId null) shows everything.
  const events = resolved.campId
    ? allEvents.filter((event) => {
        const eventCampId = typeof event.campId === "string" ? event.campId : null;
        const resolvedCamp = eventCampId && campIds.has(eventCampId) ? eventCampId : null;
        return resolvedCamp === resolved.campId || resolvedCamp === null;
      })
    : allEvents;

  const campName = resolved.campId ? (camps.find((c) => c.id === resolved.campId)?.name ?? null) : null;

  const appBaseUrl = (getPublicEnv("NEXT_PUBLIC_APP_URL") ?? new URL(request.url).origin).replace(/\/+$/, "");
  const feedUrl = `${appBaseUrl}/api/ics/${token}.ics`;

  const ics = buildCalendarFeed({
    calendarName: campName ?? "Camp schedule",
    feedUrl,
    appBaseUrl,
    feedToken: token,
    events: events as StoredCalendarEvent[],
    campName,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="camp-schedule.ics"',
      // Each token URL is unique, so a short shared CDN cache is safe and blunts
      // scraping while keeping the feed near-live (clients re-poll hourly anyway).
      "Cache-Control": "public, max-age=0, s-maxage=300",
    },
  });
}
