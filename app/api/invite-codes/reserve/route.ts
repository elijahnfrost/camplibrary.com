import { INVITE_CODE_INPUT_MAX_LENGTH, INVITE_EMAIL_MAX_LENGTH, reserveInviteCode } from "@/lib/server/inviteCodes";
import { getBackendEnvStatus } from "@/lib/server/env";
import { parseJsonObject, readTextBodyWithLimit } from "@/lib/server/requestBody";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RESERVE_BODY_BYTES = 2048;
const INVITE_BACKEND_DISABLED = {
  ok: false,
  reason: "backend_unavailable",
  message: "Invite-code account creation is temporarily unavailable. Ask a camp admin to finish setup.",
};

export async function POST(request: NextRequest) {
  if (!getBackendEnvStatus().capabilities.inviteCodes) {
    return Response.json(INVITE_BACKEND_DISABLED, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const payload = await readTextBodyWithLimit(request, MAX_RESERVE_BODY_BYTES);
  if (payload == null) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 413 });
  }

  const body = parseJsonObject(payload);
  if (body.code != null && typeof body.code !== "string") {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  if (typeof body.code === "string" && body.code.length > INVITE_CODE_INPUT_MAX_LENGTH) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  if (body.email != null && typeof body.email !== "string") {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  if (typeof body.email === "string" && body.email.length > INVITE_EMAIL_MAX_LENGTH) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code : "";
  const email = typeof body.email === "string" ? body.email : undefined;
  const result = await reserveInviteCode({
    code,
    email,
  });

  if (!result.ok) {
    const status = result.reason === "missing" ? 400 : 403;
    return Response.json({ ok: false, reason: result.reason }, { status });
  }

  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
