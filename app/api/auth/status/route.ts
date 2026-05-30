import { getAuthBackendStatus, getServerAuthSession } from "@/lib/server/auth";
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

export async function GET(request: NextRequest) {
  const backend = getBackendEnvStatus();
  const auth = getAuthBackendStatus();
  const session = await getServerAuthSession(request);

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
