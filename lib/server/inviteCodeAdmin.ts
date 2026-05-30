import type { NextRequest } from "next/server";
import { requireAdminSession } from "./auth";
import { isValidInviteAdminToken } from "./inviteCodes";

function adminTokenFrom(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

export async function authorizeInviteAdmin(request: NextRequest) {
  if (isValidInviteAdminToken(adminTokenFrom(request))) return null;
  const admin = await requireAdminSession(request);
  return admin.ok ? null : admin.response;
}
