import { authorizeInviteAdmin } from "@/lib/server/inviteCodeAdmin";
import { getBackendEnvStatus } from "@/lib/server/env";
import { createInviteCode, InviteCodeValidationError, listInviteCodes, normalizeInviteMaxUses } from "@/lib/server/inviteCodes";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Checked after authorization so a missing/unconfigured database degrades to a
// clean 503 (like the public invite routes) instead of an unhandled 500 from
// getSql(), and so backend status is never revealed to unauthenticated callers.
function backendUnavailable() {
  return Response.json(
    { ok: false, reason: "backend_unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const unauthorizedResponse = await authorizeInviteAdmin(request);
  if (unauthorizedResponse) return unauthorizedResponse;
  if (!getBackendEnvStatus().capabilities.database) return backendUnavailable();
  const invites = await listInviteCodes();
  return Response.json({ invites }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const unauthorizedResponse = await authorizeInviteAdmin(request);
  if (unauthorizedResponse) return unauthorizedResponse;
  if (!getBackendEnvStatus().capabilities.inviteCodes) return backendUnavailable();
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
  let invite: Awaited<ReturnType<typeof createInviteCode>>;
  try {
    invite = await createInviteCode({
      label: body.label,
      invitedEmail: body.invitedEmail,
      expiresAt: body.expiresAt,
      maxUses,
    });
  } catch (error) {
    if (error instanceof InviteCodeValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  return Response.json(invite, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
