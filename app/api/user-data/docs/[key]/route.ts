import type { NextRequest } from "next/server";
import { requireEditorSession } from "@/lib/server/auth";
import { getBackendEnvStatus } from "@/lib/server/env";
import { readTextBodyWithLimit } from "@/lib/server/requestBody";
import { putUserDoc } from "@/lib/server/userData";
import { isUserDocKey } from "@/lib/userDataDocs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Run lists and custom activities can carry sizeable docs (diagrams included).
const MAX_DOC_BODY_BYTES = 2 * 1024 * 1024;

type RouteContext = {
  params: Promise<{ key: string }>;
};

// The body is the raw doc value — arrays and strings are valid docs, so this
// parses any JSON value rather than coercing to an object.
function parseJsonValue(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  if (!getBackendEnvStatus().capabilities.database) {
    return Response.json(
      { ok: false, reason: "backend_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const authResult = await requireEditorSession(request);
  if (!authResult.ok) return authResult.response;

  const { key } = await context.params;
  if (!isUserDocKey(key)) {
    return Response.json({ ok: false, reason: "invalid_key" }, { status: 400 });
  }

  const payload = await readTextBodyWithLimit(request, MAX_DOC_BODY_BYTES);
  if (payload == null) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 413 });
  }
  const parsed = parseJsonValue(payload);
  if (!parsed.ok) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }

  const result = await putUserDoc(authResult.session.user.id, key, parsed.value);
  return Response.json(
    { ok: true, updatedAt: result.updatedAt },
    { headers: { "Cache-Control": "no-store" } }
  );
}
