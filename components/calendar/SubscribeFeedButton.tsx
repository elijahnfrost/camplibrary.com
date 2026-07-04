"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";
import { CampIcon } from "../icons";
import { requestConfirm } from "../ConfirmDialog";
import { FloatingLayer } from "../floating/FloatingLayer";

// The calendar's "Subscribe" control — ONE live .ics feed per camp. It's the
// final row of the View settings ledger (CalendarViewSettings), not a
// standalone rail pill: label-left "Subscribe" + this chevron trigger,
// opening a popover that ensures the active camp's single feed exists
// (creating it on first use) and always surfaces the same hotlinks: copy the
// URL, add to Google, or subscribe in Apple/Outlook. The feed is a secret URL
// that stays live as the schedule changes and links each event to its run
// sheet. There's no "make another" — switching camps switches the feed.
// "Reset link" rotates the secret if it was shared too widely (the old URL
// stops working immediately).

type CampFeed = {
  url: string;
  webcalUrl: string;
  googleAddUrl: string;
};

// Rendered only while the popover is open (see the `open` prop) — a QR nobody
// is looking at isn't worth computing. uqr's renderSVG returns a plain SVG
// string; the black/white fill colors are passed straight through as literal
// attribute values, so CSS custom properties resolve fine there too. The tile
// stays --card (near-white) regardless of surface, matching the popover, so
// the code always has full light/dark contrast to scan.
function FeedQrCode({ url, open }: { url: string; open: boolean }) {
  const markup = useMemo(() => {
    if (!open || !url) return null;
    return renderSVG(url, { pixelSize: 4, border: 1, whiteColor: "var(--card)", blackColor: "var(--ink)" });
  }, [open, url]);

  if (!markup) return null;

  return (
    <div className="subfeed__qr">
      <div
        className="subfeed__qr-tile"
        role="img"
        aria-label={"QR code for the subscription link: " + url}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
      <p className="subfeed__qr-caption">Scan to subscribe on a phone</p>
    </div>
  );
}

export function SubscribeFeedButton({
  activeCampId,
  activeCampName,
}: {
  activeCampId: string | null;
  activeCampName: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feed, setFeed] = useState<CampFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  // "idle" = just copied via the Clipboard API; "manual" = clipboard failed or
  // is unavailable, so the URL field was selected instead — the copy prompt
  // reads "Press ⌘C to copy" rather than lying that it already happened.
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const [error, setError] = useState("");
  // Feature-detected once on mount so desktop browsers without the Web Share
  // API (Safari/Chrome desktop) never show a button that would just fail.
  const [canShare, setCanShare] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const copyRevertRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The feed per camp is stable once minted, so cache it for the session: a
  // reopen (or a camp round-trip) reuses it instead of re-POSTing and flashing
  // "Preparing your link…". A reset rotates the secret and replaces the entry.
  const feedCacheRef = useRef<Map<string, CampFeed>>(new Map());
  const cacheKey = activeCampId ?? "__none__";
  // Guards ensureFeed()'s in-flight request: each call gets a fresh token, and
  // only the LATEST call's response is allowed to commit state. Without this,
  // a fast camp switch could let a stale POST for the old camp land after the
  // new camp's request and silently overwrite the feed on screen (calendar-
  // chrome-6). Mirrors useWeatherForecast's abort-guard shape.
  const requestTokenRef = useRef(0);

  // Get-or-create the single feed for the active camp, then surface its links.
  // `reset: true` rotates the secret instead of returning the existing one.
  async function ensureFeed(reset = false) {
    const token = ++requestTokenRef.current;
    if (reset) setResetting(true);
    else setLoading(true);
    setError("");
    setCopyState("idle");
    try {
      const response = await fetch("/api/calendar/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campId: activeCampId, label: activeCampName ?? undefined, reset }),
      });
      if (token !== requestTokenRef.current) return; // superseded — drop it
      if (!response.ok) throw new Error("Could not load the subscription link.");
      const body = (await response.json()) as CampFeed & { ok: true };
      const next = { url: body.url, webcalUrl: body.webcalUrl, googleAddUrl: body.googleAddUrl };
      feedCacheRef.current.set(cacheKey, next);
      setFeed(next);
    } catch (err) {
      if (token !== requestTokenRef.current) return; // superseded — drop it
      setError(err instanceof Error ? err.message : "Could not load the subscription link.");
    } finally {
      if (token === requestTokenRef.current) {
        setLoading(false);
        setResetting(false);
      }
    }
  }

  // On open (or active-camp change while open) show this camp's feed: from the
  // session cache instantly when we have it, otherwise mint it once.
  useEffect(() => {
    if (!menuOpen) return;
    const cached = feedCacheRef.current.get(cacheKey);
    if (cached) {
      setFeed(cached);
      return;
    }
    setFeed(null);
    void ensureFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, activeCampId]);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  // Clears any pending "revert the copy state" timer on unmount/close so it
  // never fires after the popover (or its inputs) are gone.
  useEffect(() => {
    return () => {
      if (copyRevertRef.current) clearTimeout(copyRevertRef.current);
    };
  }, []);

  function scheduleCopyRevert() {
    if (copyRevertRef.current) clearTimeout(copyRevertRef.current);
    copyRevertRef.current = setTimeout(() => setCopyState("idle"), 1600);
  }

  // Honest copy: only claims success once the Clipboard promise actually
  // resolves. If the API is unavailable or the write rejects (permissions,
  // insecure context, etc.) it falls back to selecting the field's text and
  // telling the user to press the keyboard shortcut themselves — never
  // reports "Copied" for something that didn't happen (fixes GAP-8 / the
  // sticky/false-success state from public-run-5).
  async function copyUrl(url: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      urlInputRef.current?.select();
      setCopyState("manual");
    }
    scheduleCopyRevert();
  }

  function shareUrl(url: string) {
    void navigator.share?.({
      title: activeCampName ? activeCampName + " schedule" : "Camp schedule",
      url,
    });
  }

  return (
    <div className="subfeed">
      <button
        ref={triggerRef}
        type="button"
        className={"subfeed__trigger" + (menuOpen ? " is-open" : "")}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-label="Subscribe to this calendar"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <CampIcon.ChevronDown />
      </button>

      {menuOpen && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect() }}
          onClose={() => setMenuOpen(false)}
          className="subfeed__menu"
          role="dialog"
          ariaLabel="Calendar subscription"
        >
          <p className="subfeed__eyebrow">Calendar subscription</p>

          {error ? (
            <div className="subfeed__errstate">
              <p className="subfeed__errmsg" role="alert" aria-live="assertive">
                {error}
              </p>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void ensureFeed()}>
                <CampIcon.Reset />
                Try again
              </button>
            </div>
          ) : loading && !feed ? (
            <p className="subfeed__muted">Preparing link…</p>
          ) : feed ? (
            <>
              <p className="subfeed__intro">
                {activeCampName ? activeCampName + "’s schedule" : "This schedule"} stays in sync in Google, Apple, or
                Outlook — and each event links to its run sheet.
              </p>

              <div className="subfeed__urlrow">
                <input
                  ref={urlInputRef}
                  className="input subfeed__url"
                  readOnly
                  value={feed.url}
                  aria-label="Subscription URL"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void copyUrl(feed.url)}
                  aria-label="Copy subscription URL"
                  title="Copy link"
                >
                  {copyState === "copied" ? <CampIcon.Check /> : <CampIcon.Copy />}
                </button>
                {canShare && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => shareUrl(feed.url)}
                    aria-label="Share subscription URL"
                    title="Share…"
                  >
                    <CampIcon.Share />
                  </button>
                )}
              </div>
              {copyState === "manual" && (
                <p className="subfeed__copyhint" role="status">
                  Press ⌘C to copy
                </p>
              )}

              <div className="subfeed__links">
                <a className="btn btn--primary" href={feed.googleAddUrl} target="_blank" rel="noopener noreferrer">
                  Add to Google Calendar
                </a>
                <a className="btn btn--ghost" href={feed.webcalUrl}>
                  Subscribe in Apple / Outlook
                </a>
              </div>

              <FeedQrCode url={feed.url} open={menuOpen} />

              <button
                type="button"
                className="subfeed__reset"
                disabled={resetting}
                onClick={async () => {
                  // NOT undoable: rotating the secret kills the URL every
                  // subscribed calendar is polling — so it confirms, per the
                  // house rule (undoable actions never confirm; irreversible
                  // ones do).
                  const ok = await requestConfirm({
                    title: "Reset the link?",
                    body: "Anyone using the current link will stop receiving the schedule until you share the new one.",
                    confirmLabel: "Reset link",
                  });
                  if (ok) void ensureFeed(true);
                }}
                title="Generate a new link and stop the old one from working"
              >
                {resetting ? "Resetting…" : "Reset link"}
              </button>
            </>
          ) : null}
        </FloatingLayer>
      )}
    </div>
  );
}
