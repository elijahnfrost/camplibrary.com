import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import type { AuthSession } from "@/lib/auth";
import { ANONYMOUS_SESSION, isAdminEmail, isClerkAuthUsable, isLocalHost, LOCAL_STAFF_SESSION } from "@/lib/auth";
import { getBackendEnvStatus } from "./env";
import { withRetries } from "./once";

// True only for the local `next dev` server. Next sets NODE_ENV to
// "development" solely for the dev server; every Vercel build — production and
// preview deployments alike — runs as "production", and the test runner uses
// "test", so this can never be true on a deployment or in unit tests. We honor
// it (in addition to the loopback-host check below) because a Conductor preview
// or LAN access can reach the dev server under a non-loopback hostname such as
// "<machine>.local:55010", which isLocalHost would otherwise reject — leaving
// the local view stuck as anonymous.
function isLocalDevServer(): boolean {
  return process.env.NODE_ENV === "development";
}

// True when the current request may use the localhost staff bypass: either the
// process is the local dev server, or the request is served from a loopback
// host. The host is read from the NextRequest when available, otherwise from the
// inbound headers. Both paths are scoped so they can never grant access on a
// deployed server.
async function isLocalRequest(request?: NextRequest): Promise<boolean> {
  if (isLocalDevServer()) return true;
  const fromRequest = request?.headers.get("host");
  if (fromRequest != null) return isLocalHost(fromRequest);
  try {
    return isLocalHost((await headers()).get("host"));
  } catch {
    return false;
  }
}

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
  // This write runs AFTER the invite is already consumed in Postgres, so a
  // transient Clerk failure here would otherwise burn the seat while leaving the
  // user unmarked (and therefore treated as anonymous). Retry to keep the two
  // systems in sync; a persistent failure still throws for the caller to handle.
  await withRetries(async () => {
    const client = await clerkClient();
    await client.users.updateUserMetadata(clerkUserId, { privateMetadata: metadata });
  });
}

export async function getServerAuthSession(request?: NextRequest): Promise<AuthSession> {
  if (await isLocalRequest(request)) return LOCAL_STAFF_SESSION;
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
  if (await isLocalRequest(request)) {
    return { ok: true, session: LOCAL_STAFF_SESSION as Extract<AuthSession, { status: "authenticated" }> };
  }
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
  if (await isLocalRequest(request)) {
    return { ok: true, session: LOCAL_STAFF_SESSION as Extract<AuthSession, { status: "authenticated" }> };
  }
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
