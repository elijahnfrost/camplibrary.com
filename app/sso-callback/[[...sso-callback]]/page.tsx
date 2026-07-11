import { AuthUnavailable } from "@/components/auth/AuthUnavailable";
import { SsoCallback } from "@/components/auth/SsoCallback";
import { getBackendEnvStatus } from "@/lib/server/env";

export default function SsoCallbackPage() {
  if (!getBackendEnvStatus().capabilities.clerkAuth) {
    return (
      <AuthUnavailable
        title="Staff access"
        message="There is no sign-in session to finish because auth is not configured in this workspace."
      />
    );
  }

  return <SsoCallback />;
}
