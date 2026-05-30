import { requireAdminSession } from "@/lib/server/auth";
import { createInviteCode, isValidInviteAdminToken, listInviteCodes } from "@/lib/server/inviteCodes";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function adminTokenFrom(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

async function authorizeInviteAdmin(request: NextRequest) {
  if (isValidInviteAdminToken(adminTokenFrom(request))) return null;
  const admin = await requireAdminSession(request);
  return admin.ok ? null : admin.response;
}

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
  };
  const invite = await createInviteCode({
    label: body.label,
    invitedEmail: body.invitedEmail,
    expiresAt: body.expiresAt,
  });
  return Response.json(invite, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
