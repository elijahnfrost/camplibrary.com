import { getBackendEnvStatus } from "@/lib/server/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const env = getBackendEnvStatus();

  return Response.json(
    {
      ok: env.ready,
      service: "camp-library",
      runtime: {
        vercel: process.env.VERCEL === "1",
        environment: process.env.VERCEL_ENV ?? "local",
        region: process.env.VERCEL_REGION ?? null,
      },
      backend: {
        requiredEnv: {
          ok: env.missingRequired.length === 0,
          missing: env.missingRequired,
        },
        capabilities: env.capabilities,
      },
    },
    {
      status: env.ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
