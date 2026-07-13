"use client";

// Live refresh: keeps a signed-in tab current with the server without a manual
// reload. A focused tab polls a tiny "version" endpoint on an interval (and
// immediately on refocus / reconnect); when the version differs from the last
// one we applied, it pulls the full snapshot and reconciles it through the same
// merge helpers the cold bootstrap uses. This is what makes an edit made
// elsewhere — another device, or an MCP / workflow agent writing straight to
// the database — appear here within a few seconds.
//
// The steady-state cost is one small request per interval: the version check is
// a pair of aggregate queries, and the heavier full GET only fires when
// something actually changed.

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { CalendarEvent } from "../calendar/types";
import type { OutboxOp } from "./cloudOutbox";
import { mergeServerDocs, mergeServerEvents, type Docs } from "./serverSync";
import { USER_DOC_KEYS, type UserDocKey } from "./userDataDocs";
// Type-only (erased at runtime, so no import cycle with cloudStore).
import type { SyncStatus } from "./cloudStore";

// How often a focused, signed-in tab asks whether anything changed. Small
// enough to feel live while watching an agent work, large enough that the cheap
// version query is negligible load.
const LIVE_POLL_MS = 5_000;

export interface LiveSyncContext {
  userId: string | null;
  scopeRef: MutableRefObject<string>;
  userIdRef: MutableRefObject<string | null>;
  bootstrappedRef: MutableRefObject<boolean>;
  authBlockedRef: MutableRefObject<boolean>;
  outboxRef: MutableRefObject<OutboxOp[]>;
  eventsRef: MutableRefObject<Record<string, CalendarEvent>>;
  docsRef: MutableRefObject<Docs>;
  /** Bumped on every local mutation. Snapshotted before a refresh's GET and
   *  re-checked after: if it moved, a local edit raced the fetch and we discard
   *  the (now possibly stale) snapshot rather than regress the edit. */
  writeGenRef: MutableRefObject<number>;
  /** The version string of the snapshot we last applied. A poll that returns a
   *  different string is the trigger to pull a fresh snapshot. */
  lastVersionRef: MutableRefObject<string | null>;
  setEvents: (next: Record<string, CalendarEvent>) => void;
  setDocs: (next: Docs) => void;
  persistEvents: (record: Record<string, CalendarEvent>) => void;
  persistDoc: (key: UserDocKey, value: unknown) => void;
  setStatus: (status: SyncStatus) => void;
}

export function useLiveSync(ctx: LiveSyncContext): void {
  // The context object is rebuilt every render; hold it in a ref so the polling
  // callbacks stay stable and always read live refs/setters.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const refreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    const c = ctxRef.current;
    if (
      !c.userIdRef.current ||
      !c.bootstrappedRef.current ||
      c.authBlockedRef.current ||
      refreshingRef.current
    ) {
      return;
    }
    refreshingRef.current = true;
    const gen = c.writeGenRef.current;
    const scope = c.scopeRef.current;
    try {
      let response: Response;
      try {
        response = await fetch("/api/user-data", { cache: "no-store" });
      } catch {
        return; // offline — the next poll retries
      }
      if (response.status === 401 || response.status === 403) {
        c.authBlockedRef.current = true;
        c.setStatus("local");
        return;
      }
      if (!response.ok) return;
      if (c.scopeRef.current !== scope) return; // signed out / switched scope mid-flight
      if (c.writeGenRef.current !== gen) return; // a local edit landed during the GET; retry on the next poll

      let body: { docs?: Record<string, unknown>; events?: unknown; version?: unknown } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        return;
      }

      // Docs: server wins except keys with a pending local edit.
      const dirtyDocKeys = new Set<UserDocKey>(
        c.outboxRef.current
          .filter((op): op is Extract<OutboxOp, { kind: "doc" }> => op.kind === "doc")
          .map((op) => op.key)
      );
      const serverDocs = body.docs && typeof body.docs === "object" ? body.docs : {};
      const nextDocs = mergeServerDocs(c.docsRef.current, serverDocs, dirtyDocKeys);
      c.docsRef.current = nextDocs;
      c.setDocs(nextDocs);
      for (const key of USER_DOC_KEYS) {
        if (!dirtyDocKeys.has(key)) c.persistDoc(key, nextDocs[key]);
      }

      // Events: server wins except ids with a pending op.
      const pendingEventIds = new Set(
        c.outboxRef.current
          .filter((op): op is Exclude<OutboxOp, { kind: "doc" }> => op.kind !== "doc")
          .map((op) => op.id)
      );
      const nextEvents = mergeServerEvents(c.eventsRef.current, body.events, pendingEventIds);
      c.eventsRef.current = nextEvents;
      c.setEvents(nextEvents);
      c.persistEvents(nextEvents);

      if (typeof body.version === "string") c.lastVersionRef.current = body.version;
      if (!c.outboxRef.current.length) c.setStatus("synced");
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  const checkVersion = useCallback(async () => {
    const c = ctxRef.current;
    if (
      !c.userIdRef.current ||
      !c.bootstrappedRef.current ||
      c.authBlockedRef.current ||
      refreshingRef.current
    ) {
      return;
    }
    // A backgrounded tab doesn't need to poll; refocus fires an immediate check.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    let response: Response;
    try {
      response = await fetch("/api/user-data/version", { cache: "no-store" });
    } catch {
      return;
    }
    if (!response.ok) return;
    let body: { version?: unknown } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return;
    }
    if (typeof body.version === "string" && body.version !== c.lastVersionRef.current) {
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined" || !ctx.userId) return;
    const tick = () => void checkVersion();
    const interval = window.setInterval(tick, LIVE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    // Immediate catch-up when the tab regains focus or the network returns, so
    // returning to the app isn't gated on the next interval.
    window.addEventListener("online", tick);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", tick);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ctx.userId, checkVersion]);
}
