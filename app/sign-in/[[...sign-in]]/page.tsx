import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { isClerkPublicKeyUsable } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  const authEnabled = isClerkPublicKeyUsable();

  return (
    <main className="auth-route">
      <div className="auth-route__brand">
        <img className="auth-route__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span className="auth-route__kicker">Camp Library</span>
        <h1 className="auth-route__title">Staff sign in</h1>
      </div>
      {authEnabled ? (
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/"
          appearance={{
            elements: {
              rootBox: "clerk-auth-box",
              cardBox: "clerk-auth-card",
            },
          }}
        />
      ) : (
        <div className="auth-route__status">
          Staff sign-in is disabled because Clerk is not configured with valid local keys.
        </div>
      )}
    </main>
  );
}
