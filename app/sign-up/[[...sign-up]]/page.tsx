import type { Metadata } from "next";
import { InviteSignUp } from "@/components/InviteSignUp";
import { getBackendEnvStatus } from "@/lib/server/env";

export const metadata: Metadata = {
  title: "Create account",
};

export default function SignUpPage() {
  const capabilities = getBackendEnvStatus().capabilities;
  const authEnabled = capabilities.clerkAuth;
  const inviteBackendEnabled = capabilities.inviteCodes;

  return (
    <main className="auth-route">
      <div className="auth-route__brand">
        <img className="auth-route__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span className="auth-route__kicker">Camp Library</span>
        <h1 className="auth-route__title">Create staff account</h1>
      </div>
      {authEnabled && inviteBackendEnabled ? (
        <InviteSignUp />
      ) : authEnabled ? (
        <div className="auth-route__status">
          Account creation is temporarily unavailable because invite codes are not fully configured.
        </div>
      ) : (
        <div className="auth-route__status">
          Account creation is disabled because Clerk is not configured with valid local keys.
        </div>
      )}
    </main>
  );
}
