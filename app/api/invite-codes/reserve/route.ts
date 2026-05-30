import { reserveInviteCode } from "@/lib/server/inviteCodes";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    email?: string;
  };
  const result = await reserveInviteCode({
    code: body.code || "",
    email: body.email,
  });

  if (!result.ok) {
    const status = result.reason === "missing" ? 400 : 403;
    return Response.json({ ok: false, reason: result.reason }, { status });
  }

  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
