import { authorizeInviteAdmin } from "@/lib/server/inviteCodeAdmin";
import { createInviteCode, listInviteCodes, normalizeInviteMaxUses } from "@/lib/server/inviteCodes";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorizedResponse = await authorizeInviteAdmin(request);
  if (unauthorizedResponse) return unauthorizedResponse;
  const invites = await listInviteCodes();
  return Response.json({ invites }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const unauthorizedResponse = await authorizeInviteAdmin(request);
  if (unauthorizedResponse) return unauthorizedResponse;
  const body = (await request.json().catch(() => ({}))) as {
    label?: string;
    invitedEmail?: string;
    expiresAt?: string | null;
    maxUses?: unknown;
    usageLimit?: unknown;
  };
  let maxUses: number;
  try {
    maxUses = normalizeInviteMaxUses(body.maxUses ?? body.usageLimit);
  } catch {
    return Response.json({ error: "maxUses must be a positive integer" }, { status: 400 });
  }
  const invite = await createInviteCode({
    label: body.label,
    invitedEmail: body.invitedEmail,
    expiresAt: body.expiresAt,
    maxUses,
  });
  return Response.json(invite, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
