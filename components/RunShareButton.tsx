"use client";

import { useEffect, useRef, useState } from "react";
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
  // "idle" = default label; "copied" = the Clipboard promise actually
  // resolved; "manual" = the API is unavailable or the write rejected, so the
  // hidden text field was selected instead and the button asks the user to
  // press the shortcut themselves — never claims "Copied" for something that
  // didn't happen (GAP-8, matches SubscribeFeedButton's copyUrl).
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const revertRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setUrl(window.location.href);
    setCanShare(typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    return () => {
      if (revertRef.current) clearTimeout(revertRef.current);
    };
  }, []);

  async function copyLink() {
    if (!url) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      urlInputRef.current?.select();
      setCopyState("manual");
    }
    if (revertRef.current) clearTimeout(revertRef.current);
    revertRef.current = setTimeout(() => setCopyState("idle"), 1600);
  }

  function shareLink() {
    if (!url) return;
    void navigator.share?.({ title, url });
  }

  return (
    <div className="runsheet-page__share">
      {/* Off-screen, not display:none — a hidden input can still be selected
          and focused for the manual "press ⌘C" fallback. Same URL as the
          address bar (the sole source of truth for this button). */}
      <input ref={urlInputRef} className="sr-only" readOnly value={url} aria-hidden="true" tabIndex={-1} />
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copyLink()} disabled={!url}>
        {copyState === "copied" ? <CampIcon.Check /> : <CampIcon.Copy />}
        {copyState === "manual" ? "Press ⌘C to copy" : copyState === "copied" ? "Copied" : "Copy link"}
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
