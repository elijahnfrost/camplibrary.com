"use client";

import { useSignIn } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { CampIcon } from "../ui/icons";

type FormState = {
  email: string;
  password: string;
  code: string;
};

type AuthMode = "sign-in" | "reset-code" | "reset-password";

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

export function StaffSignIn({
  returnTo: returnToOverride,
  message = "Existing staff can sign in with Google or password.",
  onComplete,
  onRequestSignUp,
}: {
  returnTo?: string;
  message?: string;
  onComplete?: () => void;
  onRequestSignUp?: () => void;
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, fetchStatus } = useSignIn();
  const [form, setForm] = useState<FormState>(initialForm);
  const [pending, setPending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const routeReturnTo = useMemo(
    () =>
      safeReturnPath(searchParams.get("next")) ??
      safeReturnPath(searchParams.get("returnBackUrl")) ??
      safeRedirectReturnPath(searchParams.get("redirect_url")),
    [searchParams]
  );
  const returnTo = returnToOverride ?? routeReturnTo;
  const busy = pending || fetchStatus === "fetching";
  const canSubmit = Boolean(signIn) && form.email.includes("@") && form.password.length > 0 && !busy;
  const canRequestPasswordReset = Boolean(signIn) && form.email.includes("@") && !busy;
  const canVerifyResetCode = Boolean(signIn) && form.code.trim().length > 0 && !busy;
  const canSubmitNewPassword = Boolean(signIn) && form.password.length >= 8 && !busy;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function finishSignIn() {
    if (!signIn) return;
    const finalized = await signIn.finalize();
    if (finalized.error) throw finalized.error;
    onComplete?.();
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

  async function requestPasswordReset() {
    if (!signIn) return;
    if (!form.email.includes("@")) {
      setError("Enter your email address first.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const email = form.email.trim().toLowerCase();
      const created = await signIn.create({ identifier: email });
      if (created.error) throw created.error;
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error) throw sent.error;
      setForm((current) => ({ ...current, email, password: "", code: "" }));
      setMode("reset-code");
    } catch (err) {
      setError(errorMessage(err, "Could not send a password reset code."));
    } finally {
      setPending(false);
    }
  }

  async function verifyPasswordResetCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn || !canVerifyResetCode) return;
    setPending(true);
    setError("");
    try {
      const result = await signIn.resetPasswordEmailCode.verifyCode({ code: form.code.trim() });
      if (result.error) throw result.error;
      setForm((current) => ({ ...current, password: "" }));
      setMode("reset-password");
    } catch (err) {
      setError(errorMessage(err, "Could not verify that reset code."));
    } finally {
      setPending(false);
    }
  }

  async function submitNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn || !canSubmitNewPassword) return;
    setPending(true);
    setError("");
    try {
      const result = await signIn.resetPasswordEmailCode.submitPassword({
        password: form.password,
        signOutOfOtherSessions: true,
      });
      if (result.error) throw result.error;
      if (signIn.status !== "complete") {
        throw new Error("Password reset needs another verification step. Contact the camp admin.");
      }
      await finishSignIn();
    } catch (err) {
      setError(errorMessage(err, "Could not reset that password."));
    } finally {
      setPending(false);
    }
  }

  function backToSignIn() {
    setMode("sign-in");
    setVerifying(false);
    setError("");
    update("code", "");
    update("password", "");
  }

  async function verifyCode() {
    if (!form.code.trim()) {
      setError("Enter the verification code from your email.");
      return;
    }
    if (!signIn) return;
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
        <div className="auth-form__section">Check your email</div>
        <p className="auth-form__copy">We sent a verification code to {form.email.trim()}.</p>
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
            aria-describedby={error ? "staff-signin-error" : undefined}
          />
        </div>
        {error && (
          <div className="auth-form__error" id="staff-signin-error" role="alert" aria-live="assertive">
            {error}
          </div>
        )}
        <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={verifyCode}>
          <CampIcon.Check />
          Verify
        </button>
        <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={backToSignIn}>
          Back to sign in
        </button>
      </div>
    );
  }

  if (mode === "reset-code") {
    return (
      <form className="auth-form" onSubmit={verifyPasswordResetCode}>
        <div className="auth-form__section">Reset password</div>
        <p className="auth-form__copy">We sent a reset code to {form.email.trim()}.</p>
        <div className="field">
          <label className="field__label" htmlFor="staff-reset-code">
            Reset code
          </label>
          <input
            id="staff-reset-code"
            className="input"
            value={form.code}
            onChange={(event) => update("code", event.target.value)}
            autoComplete="one-time-code"
            aria-describedby={error ? "staff-signin-error" : undefined}
          />
        </div>
        {error && (
          <div className="auth-form__error" id="staff-signin-error" role="alert" aria-live="assertive">
            {error}
          </div>
        )}
        <button type="submit" className="btn btn--primary btn--block" disabled={!canVerifyResetCode}>
          <CampIcon.Check />
          Verify code
        </button>
        <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={backToSignIn}>
          Back to sign in
        </button>
      </form>
    );
  }

  if (mode === "reset-password") {
    return (
      <form className="auth-form" onSubmit={submitNewPassword}>
        <div className="auth-form__section">Choose new password</div>
        <p className="auth-form__copy">Enter a new password for {form.email.trim()}.</p>
        <div className="field">
          <label className="field__label" htmlFor="staff-new-password">
            New password
          </label>
          <div className="password-input">
            <input
              id="staff-new-password"
              className="input password-input__control"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(event) => update("password", event.target.value)}
              autoComplete="new-password"
              aria-describedby={error ? "staff-signin-error" : undefined}
            />
            <button
              type="button"
              className="password-input__toggle"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        {error && (
          <div className="auth-form__error" id="staff-signin-error" role="alert" aria-live="assertive">
            {error}
          </div>
        )}
        <button type="submit" className="btn btn--primary btn--block" disabled={!canSubmitNewPassword}>
          <CampIcon.Check />
          Reset password
        </button>
        <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={backToSignIn}>
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={handlePasswordSubmit}>
      <div className="auth-form__section">Staff access</div>
      <p className="auth-form__copy">{message}</p>
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
          aria-describedby={error ? "staff-signin-error" : undefined}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="staff-password">
          Password
        </label>
        <div className="password-input">
          <input
            id="staff-password"
            className="input password-input__control"
            type={showPassword ? "text" : "password"}
            value={form.password}
            onChange={(event) => update("password", event.target.value)}
            autoComplete="current-password"
            aria-describedby={error ? "staff-signin-error" : undefined}
          />
          <button
            type="button"
            className="password-input__toggle"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      {error && (
        <div className="auth-form__error" id="staff-signin-error" role="alert" aria-live="assertive">
          {error}
        </div>
      )}
      <button type="submit" className="btn btn--primary btn--block" disabled={!canSubmit}>
        <CampIcon.Check />
        Sign in
      </button>
      <button type="button" className="btn btn--ghost btn--block" disabled={!canRequestPasswordReset} onClick={requestPasswordReset}>
        Reset password
      </button>
      <p className="auth-form__hint">
        New staff need an invite code to{" "}
        {onRequestSignUp ? (
          <button type="button" className="auth-form__link" onClick={onRequestSignUp}>
            create an account
          </button>
        ) : (
          <a href="/?auth=sign-up">create an account</a>
        )}
        .
      </p>
    </form>
  );
}
