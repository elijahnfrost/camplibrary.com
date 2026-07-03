"use client";

import { useEffect, useState } from "react";
import { CampIcon } from "./icons";

// Share affordance for the public, token-gated run-sheet page. The page itself
// is a server component (see app/run/[token]/[activityId]/page.tsx) — this is
// the one client island in its brand bar. It derives the URL from
// window.location on mount rather than taking the token as a prop, so it
// carries NO token-handling logic of its own: whatever loaded in the address
// bar is what gets copied/shared. Server renders the button shell (title
// prop only); the click handlers attach once JS runs, so with JS disabled the
// buttons are inert but harmless — no broken layout, no dead links.
export function RunShareButton({ title }: { title: string }) {
  const [url, setUrl] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(window.location.href);
    setCanShare(typeof navigator.share === "function");
  }, []);

  function copyLink() {
    if (!url) return;
    void navigator.clipboard?.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function shareLink() {
    if (!url) return;
    void navigator.share?.({ title, url });
  }

  return (
    <div className="runsheet-page__share">
      <button type="button" className="btn btn--ghost btn--sm" onClick={copyLink} disabled={!url}>
        {copied ? <CampIcon.Check /> : <CampIcon.Copy />}
        {copied ? "Copied" : "Copy link"}
      </button>
      {canShare && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={shareLink} disabled={!url}>
          <CampIcon.Share />
          Share…
        </button>
      )}
    </div>
  );
}
