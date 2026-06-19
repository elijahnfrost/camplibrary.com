"use client";

import { useEffect, useRef, useState } from "react";
import { CampIcon } from "../icons";
import { FloatingLayer } from "../floating/FloatingLayer";

// The calendar's "Subscribe" control — ONE live .ics feed per camp. Opening it
// ensures the active camp's single feed exists (creating it on first use) and
// always surfaces the same hotlinks: copy the URL, add to Google, or subscribe
// in Apple/Outlook. The feed is a secret URL that stays live as the schedule
// changes and links each event to its run sheet. There's no "make another" —
// switching camps switches the feed. "Reset link" rotates the secret if it was
// shared too widely (the old URL stops working immediately).

type CampFeed = {
  url: string;
  webcalUrl: string;
  googleAddUrl: string;
};

export function SubscribeFeedButton({
  activeCampId,
  activeCampName,
  canEdit,
}: {
  activeCampId: string | null;
  activeCampName: string | null;
  canEdit: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feed, setFeed] = useState<CampFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Get-or-create the single feed for the active camp, then surface its links.
  // `reset: true` rotates the secret instead of returning the existing one.
  async function ensureFeed(reset = false) {
    if (reset) setResetting(true);
    else setLoading(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch("/api/calendar/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campId: activeCampId, label: activeCampName ?? undefined, reset }),
      });
      if (!response.ok) throw new Error("Could not load the subscription link.");
      const body = (await response.json()) as CampFeed & { ok: true };
      setFeed({ url: body.url, webcalUrl: body.webcalUrl, googleAddUrl: body.googleAddUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the subscription link.");
    } finally {
      setLoading(false);
      setResetting(false);
    }
  }

  // Ensure the link whenever the menu opens or the active camp changes while
  // it's open — the dropdown always shows the current camp's one feed.
  useEffect(() => {
    if (!menuOpen) return;
    setFeed(null);
    void ensureFeed();
  }, [menuOpen, activeCampId]);

  function copyUrl(url: string) {
    void navigator.clipboard?.writeText(url);
    setCopied(true);
  }

  // Anonymous visitors have no cloud account to attach a feed to.
  if (!canEdit) return null;

  return (
    <div className="campswitch subfeed">
      <button
        ref={triggerRef}
        type="button"
        className={"campswitch__trigger" + (menuOpen ? " is-open" : "")}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-label="Subscribe to this calendar"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <CampIcon.Calendar />
        <span className="campswitch__name">Subscribe</span>
        <CampIcon.ChevronDown />
      </button>

      {menuOpen && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={() => setMenuOpen(false)}
          className="campmenu subfeed__menu"
          role="dialog"
          ariaLabel="Calendar subscription"
        >
          <p className="campmenu__eyebrow">Calendar subscription</p>
          <p className="subfeed__intro">
            {activeCampName ? activeCampName + "’s schedule" : "This schedule"} stays in sync in Google, Apple, or
            Outlook — and each event links to its run sheet.
          </p>

          {loading && !feed ? (
            <p className="subfeed__muted">Preparing your link…</p>
          ) : feed ? (
            <>
              <div className="subfeed__urlrow">
                <input
                  className="input subfeed__url"
                  readOnly
                  value={feed.url}
                  aria-label="Subscription URL"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => copyUrl(feed.url)}
                  aria-label="Copy subscription URL"
                  title="Copy link"
                >
                  {copied ? <CampIcon.Check /> : <CampIcon.Copy />}
                </button>
              </div>

              <div className="subfeed__links">
                <a className="btn btn--primary" href={feed.googleAddUrl} target="_blank" rel="noopener noreferrer">
                  Add to Google Calendar
                </a>
                <a className="btn btn--ghost" href={feed.webcalUrl}>
                  Subscribe in Apple / Outlook
                </a>
              </div>

              <button
                type="button"
                className="subfeed__reset"
                disabled={resetting}
                onClick={() => void ensureFeed(true)}
                title="Generate a new link and stop the old one from working"
              >
                {resetting ? "Resetting…" : "Reset link"}
              </button>
            </>
          ) : null}

          {error && (
            <div className="auth-form__error" role="alert" aria-live="assertive">
              {error}
            </div>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}
