"use client";

import { useSignUp } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CampIcon } from "./icons";

type FormState = {
  inviteCode: string;
  name: string;
  email: string;
  password: string;
};

const initialForm: FormState = {
  inviteCode: "",
  name: "",
  email: "",
  password: "",
};

function errorMessage(reason: string) {
  if (reason === "email_mismatch") return "That invite code was issued for a different email.";
  if (reason === "expired") return "That invite code has expired.";
  if (reason === "unavailable") return "That invite code is no longer available.";
  return "That invite code is not valid.";
}

async function reserveInviteCode(inviteCode: string, email?: string) {
  const response = await fetch("/api/invite-codes/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: inviteCode, email }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    reservationId?: string;
    reason?: string;
  };
  if (!response.ok || !body.ok || !body.reservationId) {
    throw new Error(errorMessage(body.reason || "invalid"));
  }
  return body.reservationId;
}

async function completeInviteCode(inviteCode: string, reservationId: string) {
  const response = await fetch("/api/invite-codes/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: inviteCode, reservationId }),
  });
  if (!response.ok) throw new Error("Your account was created, but the invite code could not be finalized.");
}

export function InviteSignUp() {
  const router = useRouter();
  const { signUp, fetchStatus } = useSignUp();
  const [form, setForm] = useState<FormState>(initialForm);
  const [verificationCode, setVerificationCode] = useState("");
  const [pending, setPending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [reserved, setReserved] = useState<{ inviteCode: string; reservationId: string } | null>(null);
  const [error, setError] = useState("");

  const hasInviteCode = form.inviteCode.trim().length > 0;
  const hasValidCredentials = form.email.includes("@") && form.password.length >= 8;
  const canSubmitCredentials =
    Boolean(signUp) &&
    hasValidCredentials &&
    !pending &&
    fetchStatus !== "fetching";
  const canSubmit = canSubmitCredentials && hasInviteCode;
  const disablePasswordSubmit = pending || fetchStatus === "fetching" || (hasInviteCode && (!signUp || !hasValidCredentials));

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createWithPassword() {
    if (!hasInviteCode) {
      setError("Enter your invite code to create an account.");
      return;
    }
    if (!signUp || !canSubmit) return;
    setPending(true);
    setError("");
    try {
      const reservationId = await reserveInviteCode(form.inviteCode, form.email);
      const nameParts = form.name.trim().split(/\s+/).filter(Boolean);
      const created = await signUp.password({
        emailAddress: form.email.trim().toLowerCase(),
        password: form.password,
        firstName: nameParts[0] || undefined,
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined,
        unsafeMetadata: {
          inviteCode: form.inviteCode,
          inviteReservationId: reservationId,
        },
      });
      if (created.error) throw new Error(created.error.longMessage || created.error.message);
      const sent = await signUp.verifications.sendEmailCode();
      if (sent.error) throw new Error(sent.error.longMessage || sent.error.message);
      setReserved({ inviteCode: form.inviteCode, reservationId });
      setVerifying(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that account.");
    } finally {
      setPending(false);
    }
  }

  async function verifyEmail() {
    if (!signUp || !reserved) return;
    if (!verificationCode.trim()) {
      setError("Enter the verification code from your email.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await signUp.verifications.verifyEmailCode({ code: verificationCode.trim() });
      if (result.error) throw new Error(result.error.longMessage || result.error.message);
      if (signUp.status !== "complete" || !signUp.createdSessionId) {
        throw new Error("Email verification is not complete yet.");
      }
      const finalized = await signUp.finalize();
      if (finalized.error) throw new Error(finalized.error.longMessage || finalized.error.message);
      await completeInviteCode(reserved.inviteCode, reserved.reservationId);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify that code.");
    } finally {
      setPending(false);
    }
  }

  async function createWithGoogle() {
    if (!hasInviteCode) {
      setError("Enter your invite code to continue with Google.");
      return;
    }
    if (!signUp) return;
    setPending(true);
    setError("");
    try {
      const reservationId = await reserveInviteCode(form.inviteCode);
      const result = await signUp.sso({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectCallbackUrl: "/sso-callback",
        unsafeMetadata: {
          inviteCode: form.inviteCode,
          inviteReservationId: reservationId,
        },
      });
      if (result.error) throw new Error(result.error.longMessage || result.error.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-up.");
      setPending(false);
    }
  }

  if (verifying) {
    return (
      <div className="auth-form">
        <div className="auth-form__section">Check your email</div>
        <p className="auth-form__copy">We sent a verification code to {form.email.trim()}.</p>
        <div className="field">
          <label className="field__label" htmlFor="verification-code">
            Verification code
          </label>
          <input
            id="verification-code"
            className="input"
            value={verificationCode}
            onChange={(event) => setVerificationCode(event.target.value)}
            autoComplete="one-time-code"
          />
        </div>
        {error && <div className="auth-form__error">{error}</div>}
        <button type="button" className="btn btn--primary btn--block" disabled={pending} onClick={verifyEmail}>
          <CampIcon.Check />
          Verify email
        </button>
      </div>
    );
  }

  return (
    <div className="auth-form">
      <div className="auth-form__section">Create staff account</div>
      <p className="auth-form__copy">New staff start with an invite code, then choose Google or email.</p>
      <div className="field">
        <label className="field__label" htmlFor="invite-code">
          Invite code
        </label>
        <input
          id="invite-code"
          className="input"
          value={form.inviteCode}
          onChange={(event) => update("inviteCode", event.target.value)}
          autoComplete="off"
        />
      </div>

      <button type="button" className="btn btn--primary btn--block" disabled={pending} onClick={createWithGoogle}>
        <CampIcon.User />
        Continue with Google
      </button>

      <div className="auth-form__divider">or</div>

      <div className="field">
        <label className="field__label" htmlFor="staff-name">
          Name
        </label>
        <input
          id="staff-name"
          className="input"
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          autoComplete="name"
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="staff-email">
          Email
        </label>
        <input
          id="staff-email"
          className="input"
          type="email"
          value={form.email}
          onChange={(event) => update("email", event.target.value)}
          autoComplete="email"
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="staff-password">
          Password
        </label>
        <input
          id="staff-password"
          className="input"
          type="password"
          value={form.password}
          onChange={(event) => update("password", event.target.value)}
          autoComplete="new-password"
        />
      </div>
      {error && <div className="auth-form__error">{error}</div>}
      <button type="button" className="btn btn--primary btn--block" disabled={disablePasswordSubmit} onClick={createWithPassword}>
        <CampIcon.Check />
        Create account
      </button>
    </div>
  );
}
