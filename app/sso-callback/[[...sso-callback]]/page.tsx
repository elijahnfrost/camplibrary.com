import { SsoCallback } from "@/components/SsoCallback";
import { getBackendEnvStatus } from "@/lib/server/env";

export default function SsoCallbackPage() {
  if (!getBackendEnvStatus().capabilities.clerkAuth) {
    return (
      <main className="auth-route">
        <div className="auth-route__status">
          SSO sign-in is disabled because Clerk is not configured with valid local keys.
        </div>
      </main>
    );
  }

  return <SsoCallback />;
}
