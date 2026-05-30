import { authorizeInviteAdmin } from "@/lib/server/inviteCodeAdmin";
import { deactivateInviteCode } from "@/lib/server/inviteCodes";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function deactivateResponse(id: string) {
  const result = await deactivateInviteCode(id);
  if (!result.ok) {
    const status =
      result.reason === "missing" || result.reason === "invalid" ? 400 : result.reason === "not_found" ? 404 : 409;
    return Response.json(
      { ok: false, reason: result.reason },
      {
        status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return Response.json(
    { ok: true, invite: result.record },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const unauthorizedResponse = await authorizeInviteAdmin(request);
  if (unauthorizedResponse) return unauthorizedResponse;

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    status?: string;
  };
  if (body.action && body.action !== "deactivate") {
    return Response.json(
      { ok: false, reason: "invalid_action" },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  if (body.status && body.status !== "revoked" && body.status !== "deactivated") {
    return Response.json(
      { ok: false, reason: "invalid_status" },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const { id } = await context.params;
  return deactivateResponse(id);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const unauthorizedResponse = await authorizeInviteAdmin(request);
  if (unauthorizedResponse) return unauthorizedResponse;

  const { id } = await context.params;
  return deactivateResponse(id);
}
