import type { Metadata } from "next";
import { AuthUnavailable } from "@/components/AuthUnavailable";
import { AuthComplete } from "@/components/AuthComplete";
import { getBackendEnvStatus } from "@/lib/server/env";

export const metadata: Metadata = {
  title: "Finalizing sign in",
};

export default function AuthCompletePage() {
  if (!getBackendEnvStatus().capabilities.clerkAuth) {
    return (
      <AuthUnavailable
        title="Almost done"
        message="There is no staff account flow to finish because auth is not configured in this workspace."
      />
    );
  }

  return (
    <main className="auth-route">
      <div className="auth-route__brand">
        <img className="auth-route__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span className="auth-route__kicker">Camp Library</span>
        <h1 className="auth-route__title">Almost done</h1>
      </div>
      <AuthComplete />
    </main>
  );
}
