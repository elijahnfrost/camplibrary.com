"use client";

import type { StaffActionGate } from "@/lib/auth";
import { Modal } from "../ui/Modal";
import { InviteSignUp } from "./InviteSignUp";
import { StaffSignIn } from "./StaffSignIn";

// A pending staff prompt: the failed action-gate reason, which auth mode to
// show, and where to return afterward.
export type StaffPrompt = Extract<StaffActionGate, { allowed: false }> & {
  mode: "sign-in" | "sign-up";
  returnTo: string;
};

// The ONE auth modal: covers both an interrupted edit action (signed-out,
// attempting a staff-gated change) and every intentional sign-in / sign-up
// entry point (the profile popover's "Sign in" row, a ?auth= deep link). It
// replaced the old dedicated Staff tab, which no longer exists as a surface.
export function StaffPromptModal({
  prompt,
  authEnabled,
  onClose,
  onRequestSignUp,
  onRequestSignIn,
}: {
  prompt: StaffPrompt;
  authEnabled: boolean;
  onClose: () => void;
  onRequestSignUp: () => void;
  onRequestSignIn: () => void;
}) {
  return (
    <Modal label="Staff sign-in" onClose={onClose} overlayProps={{ className: "overlay--auth" }}>
      {authEnabled ? (
        prompt.mode === "sign-up" ? (
          <>
            <InviteSignUp />
            <p className="auth-form__hint">
              Already have an account?{" "}
              <button type="button" className="auth-form__link" onClick={onRequestSignIn}>
                Sign in
              </button>
            </p>
          </>
        ) : (
          <StaffSignIn
            returnTo={prompt.returnTo}
            message={prompt.message}
            onComplete={onClose}
            onRequestSignUp={onRequestSignUp}
          />
        )
      ) : (
        <div className="auth-form auth-form--prompt">
          <div className="auth-form__section">Staff access</div>
          <p className="auth-form__copy">{prompt.message}</p>
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            Back to browsing
          </button>
        </div>
      )}
    </Modal>
  );
}
