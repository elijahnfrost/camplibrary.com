import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffSignIn } from "@/components/StaffSignIn";
import { getBackendEnvStatus } from "@/lib/server/env";

export const metadata: Metadata = {
  title: "Staff access",
};

export default function SignInPage() {
  // No accounts in this workspace — never strand the visitor on a dead page;
  // the whole app works anonymously, so send them straight back into it.
  if (!getBackendEnvStatus().capabilities.clerkAuth) redirect("/");

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
