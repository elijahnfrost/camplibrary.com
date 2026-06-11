import type { NextRequest } from "next/server";
import { requireEditorSession } from "@/lib/server/auth";
import { getBackendEnvStatus } from "@/lib/server/env";
import { getUserDocs, listCalendarEvents } from "@/lib/server/userData";

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
  const [docs, events] = await Promise.all([getUserDocs(userId), listCalendarEvents(userId)]);

  return Response.json(
    { ok: true, docs, events, serverTime: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
