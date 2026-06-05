"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useMemo } from "react";
import type { AuthSession } from "@/lib/auth";
import { ANONYMOUS_SESSION, isAdminEmail, isClerkPublicKeyUsable } from "@/lib/auth";
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
      session: ANONYMOUS_SESSION,
      signedIn: false,
      openAuth: () => {
        window.location.href = "/sign-in";
      },
      signOut: () => undefined,
    };
  }

  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();

  const session: AuthSession = useMemo(() => {
    if (!isLoaded || !isSignedIn || !user) return ANONYMOUS_SESSION;
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
      authenticatedAt: user.lastSignInAt?.toISOString() || new Date().toISOString(),
    };
  }, [isLoaded, isSignedIn, user]);

  return {
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
