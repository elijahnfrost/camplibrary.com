import { auth, currentUser } from "@clerk/nextjs/server";
import { isClerkAuthUsable } from "@/lib/auth";
import { consumeInviteCode } from "@/lib/server/inviteCodes";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isClerkAuthUsable()) {
    return Response.json({ error: "Authentication provider is not configured", code: "AUTH_DISABLED" }, { status: 503 });
  }

  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    reservationId?: string;
  };

  const ok = await consumeInviteCode({
    code: body.code || "",
    reservationId: body.reservationId || "",
    clerkUserId: userId,
    userEmail: (await currentUser())?.primaryEmailAddress?.emailAddress || null,
  });

  if (!ok) {
    return Response.json({ ok: false, error: "Invite code could not be consumed" }, { status: 409 });
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
