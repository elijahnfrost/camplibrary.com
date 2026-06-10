import { getAuthBackendStatus, getServerAuthSession, requireAdminSession } from "@/lib/server/auth";
import { getBackendEnvStatus } from "@/lib/server/env";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function publicCapabilities(capabilities: ReturnType<typeof getBackendEnvStatus>["capabilities"]) {
  return {
    auth: capabilities.clerkAuth,
    database: capabilities.database,
    inviteCodes: capabilities.inviteCodes,
    webhook: capabilities.clerkWebhook,
    cloudflareBridge: capabilities.cloudflareBridge,
  };
}

function shouldShowDiagnostics() {
  return process.env.VERCEL_ENV !== "production" && process.env.NODE_ENV !== "production";
}

export async function GET(request: NextRequest) {
  const backend = getBackendEnvStatus();
  const auth = getAuthBackendStatus();
  const session = await getServerAuthSession(request);
  const showDiagnostics = shouldShowDiagnostics() || (await requireAdminSession(request)).ok;
  if (!showDiagnostics) {
    return Response.json(
      {
        ok: true,
        auth: {
          connected: auth.connected,
        },
        session: {
          status: session.status,
        },
        status: backend.ready ? "ready" : "degraded",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return Response.json(
    {
      ok: true,
      auth,
      session,
      capabilities: publicCapabilities(backend.capabilities),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
