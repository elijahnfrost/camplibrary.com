"use client";

import { useSignIn } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { CampIcon } from "./icons";

type FormState = {
  email: string;
  password: string;
  code: string;
};

const initialForm: FormState = {
  email: "",
  password: "",
  code: "",
};

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const record = error as { longMessage?: unknown; message?: unknown; errors?: unknown };
    if (typeof record.longMessage === "string") return record.longMessage;
    if (typeof record.message === "string") return record.message;
    if (Array.isArray(record.errors)) {
      const first = record.errors[0] as { longMessage?: unknown; message?: unknown } | undefined;
      if (typeof first?.longMessage === "string") return first.longMessage;
      if (typeof first?.message === "string") return first.message;
    }
  }
  return fallback;
}

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function safeRedirectReturnPath(value: string | null) {
  if (!value) return "/";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (typeof window === "undefined") return "/";

  try {
    const url = new URL(value);
    if (url.origin !== window.location.origin) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

export function StaffSignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, fetchStatus } = useSignIn();
  const [form, setForm] = useState<FormState>(initialForm);
  const [pending, setPending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  const returnTo = useMemo(
    () =>
      safeReturnPath(searchParams.get("next")) ??
      safeReturnPath(searchParams.get("returnBackUrl")) ??
      safeRedirectReturnPath(searchParams.get("redirect_url")),
    [searchParams]
  );
  const busy = pending || fetchStatus === "fetching";
  const canSubmit = Boolean(signIn) && form.email.includes("@") && form.password.length > 0 && !busy;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function finishSignIn() {
    if (!signIn) return;
    const finalized = await signIn.finalize();
    if (finalized.error) throw finalized.error;
    router.push(returnTo);
    router.refresh();
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn || !canSubmit) return;
    setPending(true);
    setError("");
    try {
      const result = await signIn.password({
        identifier: form.email.trim().toLowerCase(),
        password: form.password,
      });
      if (result.error) throw result.error;
      if (signIn.status === "complete") {
        await finishSignIn();
        return;
      }
      if (signIn.status === "needs_client_trust") {
        const sent = await signIn.mfa.sendEmailCode();
        if (sent.error) throw sent.error;
        setVerifying(true);
        return;
      }
      throw new Error("Additional verification is needed. Try Google or contact the camp admin.");
    } catch (err) {
      setError(errorMessage(err, "Could not sign in with that email and password."));
    } finally {
      setPending(false);
    }
  }

  async function verifyCode() {
    if (!signIn || !form.code.trim()) return;
    setPending(true);
    setError("");
    try {
      const result = await signIn.mfa.verifyEmailCode({ code: form.code.trim() });
      if (result.error) throw result.error;
      if (signIn.status !== "complete") throw new Error("That code was accepted, but sign-in is not complete yet.");
      await finishSignIn();
    } catch (err) {
      setError(errorMessage(err, "Could not verify that code."));
    } finally {
      setPending(false);
    }
  }

  async function continueWithGoogle() {
    if (!signIn) return;
    setPending(true);
    setError("");
    try {
      const result = await signIn.sso({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectCallbackUrl: returnTo,
      });
      if (result.error) throw result.error;
    } catch (err) {
      setError(errorMessage(err, "Could not start Google sign-in."));
      setPending(false);
    }
  }

  if (verifying) {
    return (
      <div className="auth-form">
        <div className="auth-form__section">Check email</div>
        <p className="auth-form__copy">Enter the verification code sent to {form.email.trim()}.</p>
        <div className="field">
          <label className="field__label" htmlFor="staff-code">
            Verification code
          </label>
          <input
            id="staff-code"
            className="input"
            value={form.code}
            onChange={(event) => update("code", event.target.value)}
            autoComplete="one-time-code"
          />
        </div>
        {error && <div className="auth-form__error">{error}</div>}
        <button type="button" className="btn btn--primary btn--block" disabled={busy || !form.code.trim()} onClick={verifyCode}>
          <CampIcon.Check />
          Verify
        </button>
        <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={() => setVerifying(false)}>
          Use password instead
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={handlePasswordSubmit}>
      <div className="auth-form__section">Staff access</div>
      <button type="button" className="btn btn--primary btn--block" disabled={busy || !signIn} onClick={continueWithGoogle}>
        <CampIcon.User />
        Continue with Google
      </button>

      <div className="auth-form__divider">or</div>

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
          autoComplete="current-password"
        />
      </div>
      {error && <div className="auth-form__error">{error}</div>}
      <button type="submit" className="btn btn--primary btn--block" disabled={!canSubmit}>
        <CampIcon.Check />
        Sign in
      </button>
      <p className="auth-form__hint">
        New staff? <a href="/sign-up">Use an invite code.</a>
      </p>
    </form>
  );
}
