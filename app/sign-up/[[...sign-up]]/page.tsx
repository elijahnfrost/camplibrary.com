import type { Metadata } from "next";
import { AuthUnavailable } from "@/components/AuthUnavailable";
import { InviteSignUp } from "@/components/InviteSignUp";
import { getBackendEnvStatus } from "@/lib/server/env";

export const metadata: Metadata = {
  title: "Create account",
};

export default function SignUpPage() {
  const capabilities = getBackendEnvStatus().capabilities;
  if (!capabilities.clerkAuth) {
    return (
      <AuthUnavailable
        title="Create staff account"
        message="Staff account creation is not configured in this workspace. Ask the camp admin to enable auth and invite codes."
      />
    );
  }
  const inviteBackendEnabled = capabilities.inviteCodes;

  return (
    <main className="auth-route">
      <div className="auth-route__brand">
        <img className="auth-route__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span className="auth-route__kicker">Camp Library</span>
        <h1 className="auth-route__title">Create staff account</h1>
      </div>
      {inviteBackendEnabled ? (
        <InviteSignUp />
      ) : (
        <>
          <div className="auth-route__status">
            Account creation is temporarily unavailable because invite codes are not fully configured.
          </div>
          <a className="btn btn--quiet" href="/">
            Back to the app
          </a>
        </>
      )}
    </main>
  );
}
