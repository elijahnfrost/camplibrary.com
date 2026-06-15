import { authorizeInviteAdmin } from "@/lib/server/inviteCodeAdmin";
import { getBackendEnvStatus } from "@/lib/server/env";
import { deactivateInviteCode } from "@/lib/server/inviteCodes";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// After authorization: a missing database degrades to a clean 503 rather than an
// unhandled 500 from getSql(), matching the other data routes.
function backendUnavailable() {
  return Response.json(
    { ok: false, reason: "backend_unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

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
  if (!getBackendEnvStatus().capabilities.database) return backendUnavailable();

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
  if (!getBackendEnvStatus().capabilities.database) return backendUnavailable();

  const { id } = await context.params;
  return deactivateResponse(id);
}
