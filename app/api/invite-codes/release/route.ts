import {
  INVITE_CODE_INPUT_MAX_LENGTH,
  releaseInviteCode,
} from "@/lib/server/inviteCodes";
import { getBackendEnvStatus } from "@/lib/server/env";
import { parseJsonObject, readTextBodyWithLimit } from "@/lib/server/requestBody";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RELEASE_BODY_BYTES = 2048;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

  const payload = await readTextBodyWithLimit(request, MAX_RELEASE_BODY_BYTES);
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
  if (body.reservationId != null && typeof body.reservationId !== "string") {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code : "";
  const reservationId = typeof body.reservationId === "string" ? body.reservationId : "";
  if (!code || !reservationId) {
    return Response.json({ ok: false, reason: "missing" }, { status: 400 });
  }
  if (!UUID_PATTERN.test(reservationId)) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }

  const result = await releaseInviteCode({ code, reservationId });
  if (!result.ok && (result.reason === "missing" || result.reason === "invalid")) {
    return Response.json({ ok: false, reason: result.reason }, { status: 400 });
  }

  return Response.json(
    { ok: true },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
