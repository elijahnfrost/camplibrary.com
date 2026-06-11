import type { NextRequest } from "next/server";
import { requireEditorSession } from "@/lib/server/auth";
import { getBackendEnvStatus } from "@/lib/server/env";
import { parseJsonObject, readTextBodyWithLimit } from "@/lib/server/requestBody";
import { deleteCalendarEvent, upsertCalendarEvent } from "@/lib/server/userData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_EVENT_BODY_BYTES = 64 * 1024;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function backendUnavailable() {
  return Response.json(
    { ok: false, reason: "backend_unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}

// PUT is an idempotent upsert keyed by the client-generated UUID — the whole
// offline-retry story rests on replays being harmless.
export async function PUT(request: NextRequest, context: RouteContext) {
  if (!getBackendEnvStatus().capabilities.database) return backendUnavailable();

  const authResult = await requireEditorSession(request);
  if (!authResult.ok) return authResult.response;

  const payload = await readTextBodyWithLimit(request, MAX_EVENT_BODY_BYTES);
  if (payload == null) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 413 });
  }
  const body = parseJsonObject(payload);

  const { id } = await context.params;
  if (typeof body.id !== "string" || body.id.toLowerCase() !== id.toLowerCase()) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }

  const result = await upsertCalendarEvent(authResult.session.user.id, body);
  if (!result.ok) {
    return Response.json({ ok: false, reason: result.reason }, { status: 400 });
  }
  return Response.json(
    { ok: true, event: result.event },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!getBackendEnvStatus().capabilities.database) return backendUnavailable();

  const authResult = await requireEditorSession(request);
  if (!authResult.ok) return authResult.response;

  const { id } = await context.params;
  const ok = await deleteCalendarEvent(authResult.session.user.id, id);
  if (!ok) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
