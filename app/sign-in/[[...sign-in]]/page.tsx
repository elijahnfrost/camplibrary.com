import type { Metadata } from "next";
import { StaffSignIn } from "@/components/StaffSignIn";
import { getBackendEnvStatus } from "@/lib/server/env";

export const metadata: Metadata = {
  title: "Staff access",
};

export default function SignInPage() {
  const authEnabled = getBackendEnvStatus().capabilities.clerkAuth;

  return (
    <main className="auth-route">
      <div className="auth-route__brand">
        <img className="auth-route__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span className="auth-route__kicker">Camp Library</span>
        <h1 className="auth-route__title">Staff access</h1>
      </div>
      {authEnabled ? (
        <StaffSignIn />
      ) : (
        <div className="auth-route__status">
          Staff sign-in is disabled because Clerk is not configured with valid local keys.
        </div>
      )}
    </main>
  );
}
