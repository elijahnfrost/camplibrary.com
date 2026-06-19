import type { NextRequest } from "next/server";
import { requireEditorSession } from "@/lib/server/auth";
import { revokeCalendarFeedToken } from "@/lib/server/calendarFeeds";
import { getBackendEnvStatus } from "@/lib/server/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authResult = await requireEditorSession(request);
  if (!authResult.ok) return authResult.response;
  if (!getBackendEnvStatus().capabilities.database) {
    return Response.json(
      { ok: false, reason: "backend_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const revoked = await revokeCalendarFeedToken(authResult.session.user.id, id);
  if (!revoked) {
    return Response.json({ ok: false, reason: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
