import type { NextRequest } from "next/server";
import { requireEditorSession } from "@/lib/server/auth";
import { getBackendEnvStatus } from "@/lib/server/env";
import { getUserDataVersion, getUserDocs, listCalendarEvents } from "@/lib/server/userData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Bootstrap: everything the signed-in client needs in one round trip.
export async function GET(request: NextRequest) {
  if (!getBackendEnvStatus().capabilities.database) {
    return Response.json(
      { ok: false, reason: "backend_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const authResult = await requireEditorSession(request);
  if (!authResult.ok) return authResult.response;

  const userId = authResult.session.user.id;
  // Read the version BEFORE the payload so the client's live-refresh cursor can
  // only ever lag the data it seeds, never lead it: a write landing between the
  // two reads is included in the payload and simply triggers one more (harmless)
  // refresh on the next poll — it can't leave the client believing it's current
  // while missing that change.
  const version = await getUserDataVersion(userId);
  const [docs, events] = await Promise.all([getUserDocs(userId), listCalendarEvents(userId)]);

  return Response.json(
    { ok: true, version, docs, events, serverTime: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
