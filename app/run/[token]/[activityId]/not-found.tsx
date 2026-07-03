// Branded 404 for the public, token-gated run-sheet page. Catches BOTH
// notFound() calls in page.tsx (an unresolvable feed token and a missing/
// deleted activity) — deliberately worded so it never reveals which case
// happened (a revoked token should read identically to a stale activity link,
// so a token's validity is never leaked). No app chrome: this is reached by
// someone who was never signed in and never will be.

import type { Metadata } from "next";
import "./runsheet.css";

export const metadata: Metadata = {
  // The root layout's title template appends "· Camp Library" already.
  title: "Run sheet not found",
  robots: { index: false, follow: false },
};

export default function RunSheetNotFound() {
  return (
    <main className="runsheet-page">
      <div className="runsheet-page__bar">
        <span className="runsheet-page__brand">Camp Library</span>
      </div>
      <div className="runsheet runsheet-notfound">
        <span className="runsheet__kicker">Run sheet</span>
        <h1 className="runsheet-notfound__title">This link isn&rsquo;t working</h1>
        <p className="runsheet-notfound__body">
          This link may have expired or been turned off. If you were expecting to see an activity
          here, ask whoever shared the calendar invite for a fresh link.
        </p>
      </div>
    </main>
  );
}
