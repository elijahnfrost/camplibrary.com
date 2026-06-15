"use client";

import type { AuthSession } from "@/lib/auth";
import { CampIcon } from "./icons";
import { InviteSignUp } from "./InviteSignUp";
import { StaffSignIn } from "./StaffSignIn";

export type StaffTabMode = "sign-in" | "sign-up";

/**
 * The dedicated staff surface (a sidebar nav item, not a modal). Signed out it
 * hosts the full sign-in / invite sign-up flow; signed in it becomes the
 * account panel. This is the single intentional auth entry point — the old
 * top-right pill and sidebar identity line were removed in favour of it. The
 * only place that still opens a quick inline modal is an interrupted edit
 * action, so the user doesn't lose their place mid-edit.
 */
export function StaffTab({
  session,
  authEnabled,
  mode,
  message,
  returnTo,
  onMode,
  onSwitchAccount,
  onSignOut,
}: {
  session: AuthSession;
  authEnabled: boolean;
  mode: StaffTabMode;
  /** Optional context line (e.g. why sign-in was requested) above the form. */
  message?: string;
  /** Where StaffSignIn sends the user after a successful sign-in. */
  returnTo?: string;
  onMode: (mode: StaffTabMode) => void;
  onSwitchAccount: () => void;
  onSignOut: () => void;
}) {
  const signedIn = session.status === "authenticated";

  return (
    <div className="app__scroll">
      <div className="staff-tab">
        <div className="staff-tab__head">
          <h1 className="staff-tab__title">{signedIn ? "Your account" : "Staff sign in"}</h1>
        </div>

        <div className="staff-tab__body">
          {signedIn ? (
            <div className="auth-form auth-form--prompt">
              <div className="auth-form__section">Account</div>
              <p className="auth-form__copy">You&apos;re signed in as {session.user.name}.</p>
              <p className="auth-form__account-email">{session.user.email}</p>
              <button type="button" className="btn btn--primary btn--block" onClick={onSwitchAccount}>
                <CampIcon.User />
                Switch account
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          ) : !authEnabled ? (
            <div className="auth-form auth-form--prompt">
              <div className="auth-form__section">Staff access</div>
              <p className="auth-form__copy">
                Staff accounts aren&rsquo;t configured in this workspace yet, so editing tools are
                unavailable — but everything is fully browsable.
              </p>
            </div>
          ) : mode === "sign-up" ? (
            <>
              <InviteSignUp />
              <p className="auth-form__hint staff-tab__switch">
                Already have an account?{" "}
                <button type="button" className="auth-form__link" onClick={() => onMode("sign-in")}>
                  Sign in
                </button>
              </p>
            </>
          ) : (
            <StaffSignIn
              returnTo={returnTo}
              message={message}
              onRequestSignUp={() => onMode("sign-up")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
