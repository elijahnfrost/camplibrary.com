"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import type { AuthSession } from "@/lib/auth";
import { ANONYMOUS_SESSION, isClerkPublicKeyUsable } from "@/lib/auth";
import { CampIcon } from "./icons";

const CLERK_ENABLED = isClerkPublicKeyUsable();

function currentSignInUrl(returnTo?: string) {
  const signInUrl = new URL("/sign-in", window.location.origin);
  const returnUrl = new URL(
    returnTo || window.location.pathname + window.location.search + window.location.hash || "/",
    window.location.origin,
  );
  signInUrl.searchParams.set("next", returnUrl.pathname + returnUrl.search + returnUrl.hash);
  signInUrl.searchParams.set("redirect_url", returnUrl.toString());
  return signInUrl.toString();
}

export function usePreviewAuth() {
  if (!CLERK_ENABLED) {
    return {
      enabled: false,
      session: ANONYMOUS_SESSION,
      signedIn: false,
      // Accounts are off here; there is no auth entry point, but keep this a
      // no-op-to-home rather than a bounce through the (redirecting) /sign-in.
      openAuth: () => {
        window.location.href = "/";
      },
      signOut: () => undefined,
    };
  }

  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();
  const [serverSession, setServerSession] = useState<AuthSession>(ANONYMOUS_SESSION);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) {
      setServerSession(ANONYMOUS_SESSION);
      return;
    }

    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { session?: AuthSession } | null) => {
        if (!cancelled) setServerSession(body?.session ?? ANONYMOUS_SESSION);
      })
      .catch(() => {
        if (!cancelled) setServerSession(ANONYMOUS_SESSION);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, user]);

  const session = useMemo(() => serverSession, [serverSession]);

  return {
    enabled: true,
    session,
    signedIn: session.status === "authenticated",
    openAuth: (returnTo?: string) => {
      window.location.href = currentSignInUrl(returnTo);
    },
    signOut: () => {
      void clerk.signOut({ redirectUrl: "/" });
    },
  };
}

export function AuthButton({
  session,
  onOpen,
  onSignOut,
}: {
  session: AuthSession;
  onOpen: () => void;
  onSignOut: () => void;
}) {
  if (session.status === "authenticated") {
    return (
      <button
        type="button"
        className="auth-pill auth-pill--signed-in"
        onClick={onSignOut}
        aria-label={"Sign out " + session.user.name}
        title="Sign out"
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
