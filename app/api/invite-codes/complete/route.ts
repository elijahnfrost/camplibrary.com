import { auth, currentUser } from "@clerk/nextjs/server";
import { isClerkAuthUsable } from "@/lib/auth";
import { consumeInviteCode } from "@/lib/server/inviteCodes";
import { markUserInviteAccepted } from "@/lib/server/auth";
import { parseJsonObject, readTextBodyWithLimit } from "@/lib/server/requestBody";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_COMPLETE_BODY_BYTES = 2048;

export async function POST(request: NextRequest) {
  if (!isClerkAuthUsable()) {
    return Response.json({ error: "Authentication provider is not configured", code: "AUTH_DISABLED" }, { status: 503 });
  }

  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const payload = await readTextBodyWithLimit(request, MAX_COMPLETE_BODY_BYTES);
  if (payload == null) {
    return Response.json({ ok: false, error: "Request body too large" }, { status: 413 });
  }
  const body = parseJsonObject(payload);
  const code = typeof body.code === "string" ? body.code : "";
  const reservationId = typeof body.reservationId === "string" ? body.reservationId : "";
  const user = await currentUser();

  const ok = await consumeInviteCode({
    code,
    reservationId,
    clerkUserId: userId,
    userEmail: user?.primaryEmailAddress?.emailAddress || null,
  });

  if (!ok) {
    return Response.json({ ok: false, error: "Invite code could not be consumed" }, { status: 409 });
  }

  await markUserInviteAccepted(userId, user?.privateMetadata);

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
