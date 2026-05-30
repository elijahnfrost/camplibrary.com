"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useMemo } from "react";
import type { AuthSession } from "@/lib/auth";
import { ANONYMOUS_SESSION, isAdminEmail } from "@/lib/auth";
import { CampIcon } from "./icons";

export function usePreviewAuth() {
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
    authOpen: false,
    openAuth: () => {
      window.location.href = "/sign-in";
    },
    closeAuth: () => undefined,
    signIn: () => undefined,
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
    <button type="button" className="auth-pill" onClick={onOpen}>
      <CampIcon.Lock />
      <span>Sign in</span>
    </button>
  );
}

export function AuthDialog(_props: {
  session?: AuthSession;
  open?: boolean;
  onClose?: () => void;
  onSignIn?: unknown;
  onSignOut?: () => void;
}) {
  return null;
}

export function AuthRequiredPanel({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="empty auth-required">
      <div className="empty__mark">
        <CampIcon.Lock />
      </div>
      <div className="empty__title">Staff sign-in required</div>
      <div className="empty__sub">Schedule edits, new activities, ratings, and saved lists are locked.</div>
      <button type="button" className="btn btn--primary" onClick={onSignIn}>
        <CampIcon.Lock />
        Sign in
      </button>
    </div>
  );
}

export function useAuthLabel(session: AuthSession) {
  return useMemo(() => {
    if (session.status === "authenticated") return "Signed in as " + session.user.name;
    return "Signed out";
  }, [session]);
}
