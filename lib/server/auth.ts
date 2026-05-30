import { auth, currentUser } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import type { AuthSession } from "@/lib/auth";
import { ANONYMOUS_SESSION, isAdminEmail } from "@/lib/auth";
import { getBackendEnvStatus } from "./env";

export type AuthBackendStatus = {
  connected: boolean;
  provider: "clerk" | "custom" | "none";
  sessionMode: "provider" | "none";
  notes: string[];
};

export function getAuthBackendStatus(): AuthBackendStatus {
  const env = getBackendEnvStatus();
  const hasClerk = env.capabilities.clerkAuth;

  return {
    connected: hasClerk,
    provider: hasClerk ? "clerk" : "none",
    sessionMode: hasClerk ? "provider" : "none",
    notes: hasClerk
      ? [
          "Clerk is configured for Google and email/password auth.",
          "New account creation is gated by one-use invite codes.",
          "Mutation routes should call requireEditorSession before persisting shared edits.",
        ]
      : ["Clerk environment keys are missing."],
  };
}

export async function getServerAuthSession(_request?: NextRequest): Promise<AuthSession> {
  const user = await currentUser();
  if (!user) return ANONYMOUS_SESSION;

  const email = user.primaryEmailAddress?.emailAddress || "";
  return {
    status: "authenticated",
    user: {
      id: user.id,
      name: user.fullName || user.firstName || email || "Camp staff",
      email,
      role: isAdminEmail(email) ? "admin" : "editor",
    },
    mode: "provider",
    authenticatedAt: user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : new Date().toISOString(),
  };
}

export async function requireEditorSession(request: NextRequest): Promise<
  | { ok: true; session: Extract<AuthSession, { status: "authenticated" }> }
  | { ok: false; response: Response }
> {
  const { userId } = await auth();
  if (userId) {
    const session = await getServerAuthSession(request);
    if (session.status === "authenticated") return { ok: true, session };
  }

  return {
    ok: false,
    response: unauthorizedResponse(),
  };
}

export async function requireAdminSession(request?: NextRequest): Promise<
  | { ok: true; session: Extract<AuthSession, { status: "authenticated" }> }
  | { ok: false; response: Response }
> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, response: unauthorizedResponse() };
  }

  const session = await getServerAuthSession(request);
  if (session.status === "authenticated" && session.user.role === "admin") {
    return { ok: true, session };
  }

  return { ok: false, response: unauthorizedResponse(403) };
}
function unauthorizedResponse(status = 401) {
  return Response.json(
    {
      error: status === 403 ? "Forbidden" : "Authentication required",
      code: status === 403 ? "FORBIDDEN" : "AUTH_REQUIRED",
    },
    { status },
  );
}
