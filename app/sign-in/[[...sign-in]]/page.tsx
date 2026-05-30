import type { Metadata } from "next";
import { StaffSignIn } from "@/components/StaffSignIn";

export const metadata: Metadata = {
  title: "Staff access",
};

export default function SignInPage() {
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
