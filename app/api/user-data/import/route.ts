import type { NextRequest } from "next/server";
import { requireEditorSession } from "@/lib/server/auth";
import { getBackendEnvStatus } from "@/lib/server/env";
import { parseJsonObject, readTextBodyWithLimit } from "@/lib/server/requestBody";
import { importUserDocs } from "@/lib/server/userData";
import type { UserDocKey } from "@/lib/cloud/userDataDocs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IMPORT_BODY_BYTES = 4 * 1024 * 1024;

// One-time localStorage → cloud migration. Existing rows win (DO NOTHING per
// key), so a second device importing later never clobbers synced data.
export async function POST(request: NextRequest) {
  if (!getBackendEnvStatus().capabilities.database) {
    return Response.json(
      { ok: false, reason: "backend_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const authResult = await requireEditorSession(request);
  if (!authResult.ok) return authResult.response;

  const payload = await readTextBodyWithLimit(request, MAX_IMPORT_BODY_BYTES);
  if (payload == null) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 413 });
  }
  const body = parseJsonObject(payload);
  const docs = body.docs;
  if (typeof docs !== "object" || docs === null || Array.isArray(docs)) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }

  const result = await importUserDocs(
    authResult.session.user.id,
    docs as Partial<Record<UserDocKey, unknown>>
  );
  return Response.json(
    { ok: true, imported: result.imported, skipped: result.skipped },
    { headers: { "Cache-Control": "no-store" } }
  );
}
