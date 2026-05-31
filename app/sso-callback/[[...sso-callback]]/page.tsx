import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { isClerkPublicKeyUsable } from "@/lib/auth";

export default function SsoCallbackPage() {
  if (!isClerkPublicKeyUsable()) {
    return (
      <main className="auth-route">
        <div className="auth-route__status">
          SSO sign-in is disabled because Clerk is not configured with valid local keys.
        </div>
      </main>
    );
  }

  return <AuthenticateWithRedirectCallback />;
}
