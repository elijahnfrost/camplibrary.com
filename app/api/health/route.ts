import { getBackendEnvStatus } from "@/lib/server/env";
import { getAuthBackendStatus } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
          missing: env.missingRequired,
        },
        capabilities: env.capabilities,
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
