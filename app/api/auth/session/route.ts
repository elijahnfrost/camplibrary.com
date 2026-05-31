import { getServerAuthSession } from "@/lib/server/auth";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getServerAuthSession(request);
  return Response.json({ session }, { headers: { "Cache-Control": "no-store" } });
}

function providerManagedResponse() {
  return Response.json(
    {
      error: "Session changes are managed by the sign-in provider",
      code: "PROVIDER_MANAGED_SESSION",
    },
    {
      status: 405,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST() {
  return providerManagedResponse();
}

export async function DELETE() {
  return providerManagedResponse();
}
