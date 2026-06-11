import type { NextRequest } from "next/server";
import { requireEditorSession } from "@/lib/server/auth";
import { getBackendEnvStatus } from "@/lib/server/env";
import { isValidDateKey, listCalendarEvents } from "@/lib/server/userData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!getBackendEnvStatus().capabilities.database) {
    return Response.json(
      { ok: false, reason: "backend_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const authResult = await requireEditorSession(request);
  if (!authResult.ok) return authResult.response;

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  if ((fromParam && !isValidDateKey(fromParam)) || (toParam && !isValidDateKey(toParam))) {
    return Response.json({ ok: false, reason: "invalid_range" }, { status: 400 });
  }

  const events = await listCalendarEvents(authResult.session.user.id, {
    from: fromParam ?? undefined,
    to: toParam ?? undefined,
  });

  return Response.json({ ok: true, events }, { headers: { "Cache-Control": "no-store" } });
}
