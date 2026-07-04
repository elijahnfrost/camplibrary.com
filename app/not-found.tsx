import type { Metadata } from "next";

// Branded 404 for the main app (GAP-1). Any path outside the defined routes —
// a stale bookmark, a typo, a link into a deleted /run share — lands here
// instead of Next's bare unstyled default. Same standalone "auth-route" card
// shell the auth pages use (AuthUnavailable, /auth/complete): full-page,
// centered, no app chrome, since there's no signed-in shell to render around
// a path that doesn't resolve to anything.
export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="auth-route">
      <div className="auth-route__brand">
        <img className="auth-route__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span className="auth-route__kicker">Camp Library</span>
        <h1 className="auth-route__title">Page not found</h1>
      </div>
      <div className="auth-form auth-form--prompt">
        <div className="auth-form__section">404</div>
        <p className="auth-form__copy">
          This page doesn&rsquo;t exist — it may have moved, or the link was mistyped.
        </p>
        <a className="btn btn--primary btn--block" href="/">
          Back to Camp Library
        </a>
      </div>
    </main>
  );
}
