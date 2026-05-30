import { getBackendEnvStatus } from "@/lib/server/env";
import { getAuthBackendStatus } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function publicEnvKey(key: string) {
  if (key === "CLERK_SECRET_KEY") return "AUTH_PROVIDER_SECRET";
  if (key === "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") return "NEXT_PUBLIC_AUTH_PROVIDER_KEY";
  if (key === "CLERK_WEBHOOK_SECRET") return "AUTH_PROVIDER_WEBHOOK_SECRET";
  return key;
}

function publicCapabilities(capabilities: ReturnType<typeof getBackendEnvStatus>["capabilities"]) {
  return {
    auth: capabilities.clerkAuth,
    database: capabilities.database,
    inviteCodes: capabilities.inviteCodes,
    webhook: capabilities.clerkWebhook,
    cloudflareBridge: capabilities.cloudflareBridge,
  };
}

export async function GET() {
  const env = getBackendEnvStatus();
  const auth = getAuthBackendStatus();

  return Response.json(
    {
      ok: true,
      service: "camp-library",
      runtime: {
        vercel: process.env.VERCEL === "1",
        environment: process.env.VERCEL_ENV ?? "local",
        region: process.env.VERCEL_REGION ?? null,
      },
      backend: {
        ready: env.ready,
        requiredEnv: {
          ok: env.missingRequired.length === 0,
          missing: env.missingRequired.map(publicEnvKey),
        },
        capabilities: publicCapabilities(env.capabilities),
        auth,
      },
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
