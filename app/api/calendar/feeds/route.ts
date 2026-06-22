import type { NextRequest } from "next/server";
import { requireEditorSession } from "@/lib/server/auth";
import {
  ensureCalendarFeedToken,
  listCalendarFeedTokens,
} from "@/lib/server/calendarFeeds";
import { getBackendEnvStatus, getPublicEnv } from "@/lib/server/env";
import { parseJsonObject, readTextBodyWithLimit } from "@/lib/server/requestBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;

function backendUnavailable() {
  return Response.json(
    { ok: false, reason: "backend_unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

// Build the public-facing feed URLs from the freshly-minted raw token. Returned
// to the owner ONCE at creation — we store only the token's digest, so this is
// the single moment the subscribe URL can be produced.
function feedUrlsFor(request: NextRequest, token: string) {
  const appBaseUrl = (getPublicEnv("NEXT_PUBLIC_APP_URL") ?? new URL(request.url).origin).replace(/\/+$/, "");
  const url = `${appBaseUrl}/api/ics/${token}.ics`;
  const webcalUrl = url.replace(/^https?:/, "webcal:");
  return {
    url,
    webcalUrl,
    // Google's "Add by URL" subscribes most reliably when the cid is the webcal://
    // form — the https form often imports a one-time copy instead of a live
    // subscription. (Apple/Outlook use webcalUrl directly.)
    googleAddUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`,
  };
}

export async function GET(request: NextRequest) {
  const authResult = await requireEditorSession(request);
  if (!authResult.ok) return authResult.response;
  if (!getBackendEnvStatus().capabilities.database) return backendUnavailable();

  const records = await listCalendarFeedTokens(authResult.session.user.id);
  // Rebuild each feed's subscribe URLs from its decrypted token, then drop the
  // raw token so it never crosses the wire — the browser only needs the URLs.
  const feeds = records.map(({ token, ...record }) =>
    token ? { ...record, ...feedUrlsFor(request, token) } : record,
  );
  return Response.json({ ok: true, feeds }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const authResult = await requireEditorSession(request);
  if (!authResult.ok) return authResult.response;
  if (!getBackendEnvStatus().capabilities.database) return backendUnavailable();

  const text = await readTextBodyWithLimit(request, MAX_BODY_BYTES);
  if (text === null) return Response.json({ ok: false, reason: "payload_too_large" }, { status: 413 });
  const body = parseJsonObject(text);

  // Idempotent: returns the camp's single feed, creating it on first use. With
  // `reset` it rotates the secret (revoke old + mint new). One feed per camp.
  const { token, record } = await ensureCalendarFeedToken({
    clerkUserId: authResult.session.user.id,
    campId: body.campId,
    label: body.label,
    forceNew: body.reset === true,
  });

  return Response.json(
    { ok: true, token, record, ...feedUrlsFor(request, token) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
