"use client";

import { useEffect } from "react";

// Client error boundary for the main app segment (GAP-1). Next.js renders this
// in place of the crashed subtree whenever a render/effect throws below the
// root layout — without it, a render crash anywhere in the app white-screens
// the whole page with no way back. Must be a Client Component and default-
// export a component accepting `error`/`reset` (Next's error.tsx contract).
// Same standalone "auth-route" card shell as not-found.tsx/AuthUnavailable —
// no app chrome to render around a crash, since the crash may BE the app
// chrome.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Errors here are already reported to the console by Next's dev overlay /
    // the platform's server logging (error.digest identifies the server-side
    // occurrence); nothing further to wire up without a dedicated telemetry
    // sink for this pass.
    console.error(error);
  }, [error]);

  return (
    <main className="auth-route">
      <div className="auth-route__brand">
        <img className="auth-route__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span className="auth-route__kicker">Camp Library</span>
        <h1 className="auth-route__title">Something went wrong</h1>
      </div>
      <div className="auth-form auth-form--prompt">
        <div className="auth-form__section">Sorry about that</div>
        <p className="auth-form__copy">
          This page hit an unexpected error. Trying again usually clears it — if it keeps
          happening, head back and pick up where you left off.
        </p>
        <button type="button" className="btn btn--primary btn--block" onClick={reset}>
          Try again
        </button>
        <a className="btn btn--ghost btn--block" href="/">
          Back to Camp Library
        </a>
      </div>
    </main>
  );
}
