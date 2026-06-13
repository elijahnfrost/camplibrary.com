"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import type { AuthSession } from "@/lib/auth";
import { ANONYMOUS_SESSION, isClerkPublicKeyUsable, signInHref } from "@/lib/auth";
import { CampIcon } from "./icons";

const CLERK_ENABLED = isClerkPublicKeyUsable();

function currentSignInUrl(returnTo?: string) {
  return signInHref(returnTo || window.location.pathname + window.location.search + window.location.hash || "/", window.location.origin);
}

// Used when Clerk is not configured (e.g. local development). There is no
// hosted sign-in, but the server still resolves a session — on localhost it
// returns a fully-privileged staff session (see lib/server/auth), so we fetch
// it once and honor whatever the server decides rather than assuming anonymous.
function useServerOnlyAuth() {
  const [session, setSession] = useState<AuthSession>(ANONYMOUS_SESSION);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { session?: AuthSession } | null) => {
        if (!cancelled) {
          setSession(body?.session ?? ANONYMOUS_SESSION);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(ANONYMOUS_SESSION);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    enabled: false,
    ready,
    session,
    signedIn: session.status === "authenticated",
    providerSignedIn: false,
    // Accounts are off here; there is no hosted auth entry point, so keep this a
    // no-op-to-home.
    openAuth: () => {
      window.location.href = "/";
    },
    signOut: (redirectUrl = "/") => {
      window.location.href = redirectUrl;
    },
  };
}

// Clerk-backed auth. Only ever invoked when Clerk is configured, so the Clerk
// hooks (which require a ClerkProvider ancestor) are safe to call here.
function useClerkAuth() {
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();
  const [serverSession, setServerSession] = useState<AuthSession>(ANONYMOUS_SESSION);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    if (!isLoaded) {
      setSessionReady(false);
      return;
    }

    if (!isSignedIn || !user) {
      setServerSession(ANONYMOUS_SESSION);
      setSessionReady(true);
      return;
    }

    let cancelled = false;
    setSessionReady(false);
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { session?: AuthSession } | null) => {
        if (!cancelled) {
          setServerSession(body?.session ?? ANONYMOUS_SESSION);
          setSessionReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setServerSession(ANONYMOUS_SESSION);
          setSessionReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, user]);

  const session = useMemo(() => serverSession, [serverSession]);

  return {
    enabled: true,
    ready: isLoaded && sessionReady,
    session,
    signedIn: session.status === "authenticated",
    providerSignedIn: Boolean(isSignedIn),
    openAuth: (returnTo?: string) => {
      window.location.href = currentSignInUrl(returnTo);
    },
    signOut: (redirectUrl = "/") => {
      void clerk.signOut({ redirectUrl });
    },
  };
}

// Bound once at module load. CLERK_ENABLED is a module-level constant, so the
// chosen implementation never changes for the lifetime of the app — the Rules
// of Hooks hold because a given mount always calls the same hook every render.
export const usePreviewAuth = CLERK_ENABLED ? useClerkAuth : useServerOnlyAuth;

export function AuthButton({
  session,
  onOpen,
  onAccount,
}: {
  session: AuthSession;
  onOpen: () => void;
  onAccount: () => void;
}) {
  if (session.status === "authenticated") {
    return (
      <button
        type="button"
        className="auth-pill auth-pill--signed-in"
        onClick={onAccount}
        aria-label={"Open account menu for " + session.user.name}
        title="Account"
      >
        <CampIcon.User />
        <span>{session.user.name}</span>
      </button>
    );
  }

  return (
    <button type="button" className="auth-pill" onClick={onOpen} aria-label="Sign in as staff" title="Sign in as staff">
      <CampIcon.User />
      <span>Staff</span>
    </button>
  );
}

export function useAuthLabel(session: AuthSession) {
  return useMemo(() => {
    if (session.status === "authenticated") return "Staff: " + session.user.name;
    return "Local workspace";
  }, [session]);
}
