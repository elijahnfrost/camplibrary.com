import type { NextRequest } from "next/server";
import { requireEditorSession } from "@/lib/server/auth";
import { getBackendEnvStatus } from "@/lib/server/env";
import { getUserDataVersion } from "@/lib/server/userData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A cheap change-signature the client polls to decide whether to pull the full
// bootstrap snapshot again. Same auth + owner scoping as GET /api/user-data, so
// the version always describes exactly the dataset that route would return.
export async function GET(request: NextRequest) {
  if (!getBackendEnvStatus().capabilities.database) {
    return Response.json(
      { ok: false, reason: "backend_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const authResult = await requireEditorSession(request);
  if (!authResult.ok) return authResult.response;

  const version = await getUserDataVersion(authResult.session.user.id);

  return Response.json({ ok: true, version }, { headers: { "Cache-Control": "no-store" } });
}
