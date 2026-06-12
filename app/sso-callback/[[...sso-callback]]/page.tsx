import { AuthUnavailable } from "@/components/AuthUnavailable";
import { SsoCallback } from "@/components/SsoCallback";
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
