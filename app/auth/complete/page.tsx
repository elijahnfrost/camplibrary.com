import type { Metadata } from "next";
import { AuthComplete } from "@/components/AuthComplete";
import { isClerkPublicKeyUsable } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Finalizing sign in",
};

export default function AuthCompletePage() {
  const authEnabled = isClerkPublicKeyUsable();

  return (
    <main className="auth-route">
      <div className="auth-route__brand">
        <img className="auth-route__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span className="auth-route__kicker">Camp Library</span>
        <h1 className="auth-route__title">Almost done</h1>
      </div>
      {authEnabled ? (
        <AuthComplete />
      ) : (
        <div className="auth-route__status">
          Account finalization is disabled because Clerk is not configured with valid local keys.
        </div>
      )}
    </main>
  );
}
