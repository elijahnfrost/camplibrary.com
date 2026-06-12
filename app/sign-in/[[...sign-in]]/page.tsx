import type { Metadata } from "next";
import { AuthUnavailable } from "@/components/AuthUnavailable";
import { StaffSignIn } from "@/components/StaffSignIn";
import { getBackendEnvStatus } from "@/lib/server/env";

export const metadata: Metadata = {
  title: "Staff access",
};

export default function SignInPage() {
  if (!getBackendEnvStatus().capabilities.clerkAuth) {
    return (
      <AuthUnavailable
        title="Staff access"
        message="Staff sign-in is not configured in this workspace, so editing tools are unavailable."
      />
    );
  }

  return (
    <main className="auth-route">
      <div className="auth-route__brand">
        <img className="auth-route__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span className="auth-route__kicker">Camp Library</span>
        <h1 className="auth-route__title">Staff access</h1>
      </div>
      <StaffSignIn />
    </main>
  );
}
