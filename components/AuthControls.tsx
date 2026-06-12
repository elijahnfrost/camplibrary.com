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

export function usePreviewAuth() {
  if (!CLERK_ENABLED) {
    return {
      enabled: false,
      ready: true,
      session: ANONYMOUS_SESSION,
      signedIn: false,
      providerSignedIn: false,
      // Accounts are off here; there is no auth entry point, so keep this a
      // no-op-to-home.
      openAuth: () => {
        window.location.href = "/";
      },
      signOut: (redirectUrl = "/") => {
        window.location.href = redirectUrl;
      },
    };
  }

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
