import { redirect } from "next/navigation";
import { SsoCallback } from "@/components/SsoCallback";
import { getBackendEnvStatus } from "@/lib/server/env";

export default function SsoCallbackPage() {
  // No accounts in this workspace — nothing to finalize, so return to the app.
  if (!getBackendEnvStatus().capabilities.clerkAuth) redirect("/");

  return <SsoCallback />;
}
