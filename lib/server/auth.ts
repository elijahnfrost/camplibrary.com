import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import type { AuthSession } from "@/lib/auth";
import { ANONYMOUS_SESSION, isAdminEmail, isClerkAuthUsable } from "@/lib/auth";
import { getBackendEnvStatus } from "./env";

const INVITE_ACCEPTED_METADATA_KEY = "campLibraryInviteAccepted";
const INVITE_ACCEPTED_AT_METADATA_KEY = "campLibraryInviteAcceptedAt";

export type AuthBackendStatus = {
  connected: boolean;
  provider: "managed" | "custom" | "none";
  sessionMode: "provider" | "none";
  notes: string[];
};

export function getAuthBackendStatus(): AuthBackendStatus {
  const env = getBackendEnvStatus();
  const hasClerk = env.capabilities.clerkAuth;

  return {
    connected: hasClerk,
    provider: hasClerk ? "managed" : "none",
    sessionMode: hasClerk ? "provider" : "none",
    notes: hasClerk
      ? [
          "Hosted sign-in is configured for Google and email/password auth.",
          "New account creation is gated by usage-limited invite codes.",
          "Mutation routes should call requireEditorSession before persisting shared edits.",
        ]
      : ["Clerk environment keys are missing or placeholders."],
  };
}

function hasAcceptedInvite(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.[INVITE_ACCEPTED_METADATA_KEY] === true;
}

export async function markUserInviteAccepted(
  clerkUserId: string,
  existingPrivateMetadata?: Record<string, unknown> | null,
) {
  const metadata = {
    ...(existingPrivateMetadata || {}),
    [INVITE_ACCEPTED_METADATA_KEY]: true,
    [INVITE_ACCEPTED_AT_METADATA_KEY]:
      typeof existingPrivateMetadata?.[INVITE_ACCEPTED_AT_METADATA_KEY] === "string"
        ? existingPrivateMetadata[INVITE_ACCEPTED_AT_METADATA_KEY]
        : new Date().toISOString(),
  };
  const client = await clerkClient();
  await client.users.updateUserMetadata(clerkUserId, { privateMetadata: metadata });
}

export async function getServerAuthSession(_request?: NextRequest): Promise<AuthSession> {
  if (!isClerkAuthUsable()) return ANONYMOUS_SESSION;

  const user = await currentUser();
  if (!user) return ANONYMOUS_SESSION;

  const email = user.primaryEmailAddress?.emailAddress || "";
  const isAdmin = isAdminEmail(email);
  if (!isAdmin && !hasAcceptedInvite(user.privateMetadata)) return ANONYMOUS_SESSION;

  return {
    status: "authenticated",
    user: {
      id: user.id,
      name: user.fullName || user.firstName || email || "Camp staff",
      email,
      role: isAdmin ? "admin" : "editor",
    },
    mode: "provider",
    authenticatedAt: user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : new Date().toISOString(),
  };
}

export async function requireEditorSession(request: NextRequest): Promise<
  | { ok: true; session: Extract<AuthSession, { status: "authenticated" }> }
  | { ok: false; response: Response }
> {
  if (!isClerkAuthUsable()) {
    return {
      ok: false,
      response: unauthorizedResponse(),
    };
  }

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
  if (!isClerkAuthUsable()) {
    return { ok: false, response: unauthorizedResponse() };
  }

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
