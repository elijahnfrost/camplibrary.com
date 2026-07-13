"use client";

// Cloud-synced replacement for the per-key useLocalStorage calls.
//
// Anon users: pure localStorage, exactly today's behavior. Signed-in users:
// state hydrates instantly from the localStorage cache (same keys as the
// legacy hooks, so historical data pre-warms it), one bootstrap GET replaces
// it with server truth, and every write is optimistic — state + cache update
// synchronously while the outbox flushes to the API in the background with
// retry/backoff. Reads never block on the network; camp wifi failing mid-day
// degrades to a queue, not an error. Last write wins everywhere.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { normalizeCalendarEvent, normalizeCalendarEventList, type CalendarEvent } from "../calendar/types";
import { MIGRATION_MARKER_KEY, collectLocalDocsForImport } from "./cloudMigration";
import { coalesce, nextRetryDelayMs, parseOutbox, serializeOutbox, type OutboxOp } from "./cloudOutbox";
import { mergeServerDocs, mergeServerEvents } from "./serverSync";
import { scopedStorageKey } from "./storageScope";
import { useLiveSync } from "./useLiveSync";
import {
  DOC_LOCAL_KEYS,
  USER_DOC_KEYS,
  docDefault,
  isUserDocKey,
  normalizeDoc,
  type DocValueMap,
  type UserDocKey,
} from "./userDataDocs";

const STORAGE_PREFIX = "camp:";
const EVENTS_LOCAL_KEY = "calendarEvents.v1";
const OUTBOX_LOCAL_KEY = "outbox.v1";
const DOC_FLUSH_DEBOUNCE_MS = 1_500;
// Calendar undo/redo: a bounded, session-only history of event mutations. Each
// entry records the affected ids' state BEFORE and AFTER the change, so undo
// re-applies `before` and redo re-applies `after` — no special-casing per op.
const UNDO_LIMIT = 50;
// id -> the event at that id, or null when it was absent (created / deleted).
type PatchMap = Record<string, CalendarEvent | null>;
type EventPatch = { before: PatchMap; after: PatchMap };

export type SyncStatus = "local" | "syncing" | "synced" | "offline";

type Docs = { [K in UserDocKey]: DocValueMap[K] };

export interface CloudUserData {
  status: SyncStatus;
  pendingCount: number;
  /** First-load readiness. False only for a signed-in user whose bootstrap GET
   *  hasn't resolved yet AND who has no usable cached data — i.e. the window
   *  where "empty" really means "still loading", not "genuinely empty". Goes true
   *  once the bootstrap resolves (server truth, local-mode fallback, or an auth
   *  block), once cached data is present, or immediately for anon visitors (their
   *  localStorage hydrate is synchronous). Lets callers tell loading from empty
   *  and gate cold-load empty-states / a loading veil. */
  hasLoaded: boolean;
  /** Set when the server refused a write (a non-auth 4xx) so the change couldn't
   *  be saved — null when sync is healthy. Surfaced to the user, not silent. */
  syncError: string | null;
  docs: Docs;
  setDoc: <K extends UserDocKey>(
    key: K,
    next: DocValueMap[K] | ((prev: DocValueMap[K]) => DocValueMap[K])
  ) => void;
  events: Record<string, CalendarEvent>;
  upsertEvent: (event: CalendarEvent) => void;
  removeEvent: (id: string) => void;
  /** Atomic batch variants for recurring-series operations — one state update,
   *  one cache write, one flush, so materializing/editing a whole series is a
   *  single render and a single undo step. */
  upsertEvents: (events: CalendarEvent[]) => void;
  removeEvents: (ids: string[]) => void;
  /** Atomic upsert+delete in one step — used by scoped series edits so the whole
   *  edit (regenerated occurrences + removed old ones) is a single undo step. */
  commitEvents: (upserts: CalendarEvent[], removes: string[]) => void;
  /** Calendar undo/redo over the event history. Each returns whether anything
   *  moved, so the caller can announce the result. Session-only (cleared on a
   *  scope change), scoped to calendar events. */
  undo: () => boolean;
  redo: () => boolean;
}

function defaultDocs(): Docs {
  const out = {} as Docs;
  for (const key of USER_DOC_KEYS) {
    (out as Record<string, unknown>)[key] = docDefault(key);
  }
  return out;
}

function readRaw(fullKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + fullKey);
  } catch {
    return null;
  }
}

function writeRaw(fullKey: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + fullKey, value);
  } catch {
    /* quota / private-mode — in-memory state still works */
  }
}

function readJson(fullKey: string): unknown {
  const raw = readRaw(fullKey);
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

type SendResult = "done" | "retry" | "auth" | "drop";

export function useCloudUserData(userId: string | null): CloudUserData {
  const scope = userId ? "user:" + userId : "anon";

  const [docs, setDocsState] = useState<Docs>(defaultDocs);
  const [events, setEventsState] = useState<Record<string, CalendarEvent>>({});
  const [status, setStatus] = useState<SyncStatus>(userId ? "syncing" : "local");
  const [pendingCount, setPendingCount] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  // First-load readiness (see CloudUserData.hasLoaded). Anon users are ready
  // immediately (synchronous localStorage hydrate); a signed-in user starts
  // unready and flips true once the bootstrap resolves or cached data is present.
  const [hasLoaded, setHasLoaded] = useState(!userId);

  const docsRef = useRef(docs);
  const eventsRef = useRef(events);
  const outboxRef = useRef<OutboxOp[]>([]);
  const scopeRef = useRef(scope);
  const userIdRef = useRef(userId);
  const flushingRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const flushAtRef = useRef(Infinity);
  const attemptRef = useRef(0);
  const bootstrappedRef = useRef(false);
  const authBlockedRef = useRef(false);
  const undoStackRef = useRef<EventPatch[]>([]);
  const redoStackRef = useRef<EventPatch[]>([]);
  // Live-refresh bookkeeping (see useLiveSync): last-applied version + a counter
  // bumped on each local mutation so a refresh can tell an edit raced its fetch.
  const lastVersionRef = useRef<string | null>(null);
  const writeGenRef = useRef(0);

  scopeRef.current = scope;
  userIdRef.current = userId;

  const docCacheKey = useCallback(
    (key: UserDocKey) => scopedStorageKey(scopeRef.current, DOC_LOCAL_KEYS[key]),
    []
  );

  const persistDoc = useCallback(
    (key: UserDocKey, value: unknown) => writeRaw(docCacheKey(key), JSON.stringify(value)),
    [docCacheKey]
  );

  const persistEvents = useCallback((record: Record<string, CalendarEvent>) => {
    writeRaw(scopedStorageKey(scopeRef.current, EVENTS_LOCAL_KEY), JSON.stringify(Object.values(record)));
  }, []);

  const persistOutbox = useCallback(() => {
    writeRaw(scopedStorageKey(scopeRef.current, OUTBOX_LOCAL_KEY), serializeOutbox(outboxRef.current));
    setPendingCount(outboxRef.current.length);
  }, []);

  const sendOp = useCallback(async (op: OutboxOp, snapshot: unknown): Promise<SendResult> => {
    let response: Response;
    try {
      if (op.kind === "doc") {
        if (snapshot === undefined) return "done";
        response = await fetch("/api/user-data/docs/" + op.key, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snapshot),
        });
      } else if (op.kind === "eventUpsert") {
        if (!snapshot) return "done"; // deleted before the flush; the delete op follows
        response = await fetch("/api/calendar-events/" + op.id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snapshot),
        });
      } else {
        response = await fetch("/api/calendar-events/" + op.id, { method: "DELETE" });
      }
    } catch {
      return "retry";
    }
    if (response.ok) return "done";
    if (response.status === 401 || response.status === 403) return "auth";
    if (response.status >= 500 || response.status === 429) return "retry";
    // Other 4xx (e.g. a payload the server rejects): a poison op would block the
    // queue forever, so we still drop it — but as "drop", not "done", so the flush
    // surfaces a "couldn't save" signal instead of silently pretending it synced.
    return "drop";
  }, []);

  const flushRef = useRef<() => Promise<void>>(async () => {});

  const scheduleFlush = useCallback((delayMs: number) => {
    if (typeof window === "undefined") return;
    const at = Date.now() + delayMs;
    if (flushTimerRef.current != null) {
      if (flushAtRef.current <= at) return; // a sooner flush is already scheduled
      window.clearTimeout(flushTimerRef.current);
    }
    flushAtRef.current = at;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushAtRef.current = Infinity;
      void flushRef.current();
    }, delayMs);
  }, []);

  flushRef.current = useCallback(async () => {
    // Gate on bootstrappedRef: flushing before the bootstrap GET resolves can
    // race it — the op gets dropped from the outbox, then bootstrap (which only
    // preserves still-pending ids) drops the freshly-created event. Bootstrap
    // kicks the flush itself once it finishes, so nothing is lost by waiting.
    if (
      flushingRef.current ||
      !userIdRef.current ||
      authBlockedRef.current ||
      !bootstrappedRef.current
    ) {
      return;
    }
    flushingRef.current = true;
    try {
      while (true) {
        const ops = coalesce(outboxRef.current);
        if (!ops.length) {
          if (bootstrappedRef.current) setStatus("synced");
          return;
        }
        setStatus("syncing");
        const op = ops[0];
        const snapshot =
          op.kind === "doc"
            ? docsRef.current[op.key]
            : op.kind === "eventUpsert"
              ? eventsRef.current[op.id]
              : null;
        const result = await sendOp(op, snapshot);
        if (result === "auth") {
          authBlockedRef.current = true;
          setStatus("local");
          return;
        }
        if (result === "retry") {
          attemptRef.current += 1;
          setStatus("offline");
          scheduleFlush(nextRetryDelayMs(attemptRef.current));
          return;
        }
        // "drop" = the server refused this write; surface it instead of silently
        // dropping. A clean "done" clears any prior error. Either way the op
        // leaves the queue below so one bad write can't wedge the rest.
        setSyncError(
          result === "drop" ? "Some changes couldn’t be saved. Try editing them again." : null
        );
        attemptRef.current = 0;
        // Drop the sent op — unless its target changed mid-flight, in which
        // case the dirty flag stays and the loop sends the newer value.
        outboxRef.current = outboxRef.current.filter((queued) => {
          if (queued.kind === "doc" && op.kind === "doc" && queued.key === op.key) {
            return docsRef.current[op.key] !== snapshot;
          }
          if (queued.kind !== "doc" && op.kind !== "doc" && queued.id === op.id) {
            const current = eventsRef.current[op.id];
            return op.kind === "eventUpsert" ? current !== snapshot : current != null;
          }
          return true;
        });
        persistOutbox();
      }
    } finally {
      flushingRef.current = false;
    }
  }, [persistOutbox, scheduleFlush, sendOp]);

  const enqueue = useCallback(
    (op: OutboxOp, delayMs: number) => {
      if (!userIdRef.current) return; // anon: no sync
      outboxRef.current = coalesce([...outboxRef.current, op]);
      persistOutbox();
      scheduleFlush(delayMs);
    },
    [persistOutbox, scheduleFlush]
  );

  const bootstrapRef = useRef<() => Promise<void>>(async () => {});
  bootstrapRef.current = useCallback(async () => {
    const currentUserId = userIdRef.current;
    if (!currentUserId || bootstrappedRef.current || authBlockedRef.current) return;
    const currentScope = scopeRef.current;
    setStatus("syncing");

    // Collect un-migrated local data BEFORE server state touches the cache.
    const markerKey = scopedStorageKey(currentScope, MIGRATION_MARKER_KEY);
    let pendingImport: Partial<Record<UserDocKey, unknown>> | null = null;
    if (typeof window !== "undefined" && readRaw(markerKey) == null) {
      try {
        pendingImport = collectLocalDocsForImport(window.localStorage, currentScope);
      } catch {
        pendingImport = {};
      }
    }

    let response: Response;
    try {
      response = await fetch("/api/user-data", { cache: "no-store" });
    } catch {
      setStatus("offline");
      attemptRef.current += 1;
      window.setTimeout(() => void bootstrapRef.current(), nextRetryDelayMs(attemptRef.current));
      return;
    }
    if (response.status === 401 || response.status === 403 || response.status === 503) {
      // Not invite-accepted, or backend unconfigured: run in local mode. The
      // cached data (if any) is all there is, so this is a terminal first-load
      // state — mark ready so the veil/empty-state gate releases.
      authBlockedRef.current = response.status !== 503;
      setStatus("local");
      setHasLoaded(true);
      return;
    }
    if (!response.ok) {
      setStatus("offline");
      attemptRef.current += 1;
      window.setTimeout(() => void bootstrapRef.current(), nextRetryDelayMs(attemptRef.current));
      return;
    }
    if (scopeRef.current !== currentScope) return; // signed out mid-flight

    let body: { docs?: Record<string, unknown>; events?: unknown; version?: unknown } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      body = {};
    }
    // Seed the live-refresh cursor from this snapshot (see useLiveSync).
    if (typeof body.version === "string") lastVersionRef.current = body.version;

    // One-time migration: upload local data; existing server rows win.
    let importedKeys: UserDocKey[] = [];
    if (pendingImport && Object.keys(pendingImport).length) {
      try {
        const importResponse = await fetch("/api/user-data/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docs: pendingImport }),
        });
        if (importResponse.ok) {
          const importBody = (await importResponse.json()) as { imported?: unknown };
          importedKeys = Array.isArray(importBody.imported)
            ? importBody.imported.filter(isUserDocKey)
            : [];
          writeRaw(markerKey, JSON.stringify(Date.now()));
        }
      } catch {
        /* no marker — retried on next load */
      }
    } else if (pendingImport != null) {
      writeRaw(markerKey, JSON.stringify(Date.now()));
    }
    if (scopeRef.current !== currentScope) return;

    // Server docs replace local state — except keys with pending local edits
    // (outbox) and keys whose local value was just imported as canonical.
    const skipDocKeys = new Set<UserDocKey>(importedKeys);
    for (const op of outboxRef.current) if (op.kind === "doc") skipDocKeys.add(op.key);
    const serverDocs = body.docs && typeof body.docs === "object" ? body.docs : {};
    const nextDocs = mergeServerDocs(docsRef.current, serverDocs, skipDocKeys);
    docsRef.current = nextDocs;
    setDocsState(nextDocs);
    for (const key of USER_DOC_KEYS) if (!skipDocKeys.has(key)) persistDoc(key, nextDocs[key]);

    // Server events replace local state — except ids with pending ops.
    const pendingEventIds = new Set(
      outboxRef.current.flatMap((op) => (op.kind === "doc" ? [] : [op.id]))
    );
    const nextEvents = mergeServerEvents(eventsRef.current, body.events, pendingEventIds);
    // First sign-in only (marker was absent → pendingImport set): adopt local
    // events the server doesn't have yet — e.g. events created while signed-out
    // and carried in from the anon scope. Each is kept locally AND queued for
    // upload. Gated to the one-time migration so it can't resurrect an event
    // deleted on another device (where "local-only" would be a stale leftover).
    if (pendingImport != null) {
      const adopted: OutboxOp[] = [];
      for (const [id, local] of Object.entries(eventsRef.current)) {
        if (nextEvents[id] || pendingEventIds.has(id)) continue;
        nextEvents[id] = local;
        adopted.push({ kind: "eventUpsert", id });
      }
      if (adopted.length) {
        outboxRef.current = coalesce([...outboxRef.current, ...adopted]);
        persistOutbox();
      }
    }
    eventsRef.current = nextEvents;
    setEventsState(nextEvents);
    persistEvents(nextEvents);

    bootstrappedRef.current = true;
    setHasLoaded(true);
    attemptRef.current = 0;
    if (outboxRef.current.length) {
      scheduleFlush(0);
    } else {
      setStatus("synced");
    }
  }, [persistDoc, persistEvents, persistOutbox, scheduleFlush]);

  // Hydrate from the localStorage cache whenever the scope changes, then
  // bootstrap from the server for signed-in users.
  useLayoutEffect(() => {
    const nextDocs = defaultDocs();
    for (const key of USER_DOC_KEYS) {
      const raw = readJson(scopedStorageKey(scope, DOC_LOCAL_KEYS[key]));
      if (raw !== undefined) {
        (nextDocs as Record<string, unknown>)[key] = normalizeDoc(key, raw);
      }
    }
    docsRef.current = nextDocs;
    setDocsState(nextDocs);

    const cachedEvents = normalizeCalendarEventList(readJson(scopedStorageKey(scope, EVENTS_LOCAL_KEY)));
    eventsRef.current = cachedEvents;
    setEventsState(cachedEvents);

    outboxRef.current = userId ? parseOutbox(readRaw(scopedStorageKey(scope, OUTBOX_LOCAL_KEY))) : [];
    setPendingCount(outboxRef.current.length);

    // Readiness: anon hydrates synchronously above (ready now). A signed-in user
    // with cached data (events OR a prior migration marker) can render that cache
    // immediately while the bootstrap refreshes in the background — don't trap
    // them behind the veil. A cold signed-in scope starts unready until bootstrap
    // resolves, so callers can hold a loading treatment instead of flashing empty.
    const hasCache =
      Object.keys(cachedEvents).length > 0 ||
      readRaw(scopedStorageKey(scope, MIGRATION_MARKER_KEY)) != null;
    setHasLoaded(!userId || hasCache);

    bootstrappedRef.current = false;
    authBlockedRef.current = false;
    attemptRef.current = 0;
    // Undo history is session-scoped: a sign-in/out swaps the whole dataset, so
    // a stale inverse op would target the wrong scope.
    undoStackRef.current = [];
    redoStackRef.current = [];
    setSyncError(null);
    setStatus(userId ? "syncing" : "local");
    if (userId) void bootstrapRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Reconnect triggers: flush (or re-bootstrap) when the network returns or
  // the tab becomes visible again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onWake = () => {
      if (!userIdRef.current) return;
      if (authBlockedRef.current) {
        // A blocked session may have since recovered (cookie/token refreshed).
        // Give it one more bootstrap attempt on reconnect/refocus instead of
        // latching "local" for the whole session — the prod "delete doesn't
        // stick" symptom. If it's still unauthorized, bootstrap re-blocks.
        authBlockedRef.current = false;
        bootstrappedRef.current = false;
        void bootstrapRef.current();
        return;
      }
      if (!bootstrappedRef.current) void bootstrapRef.current();
      else if (outboxRef.current.length) scheduleFlush(0);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onWake();
    };
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [scheduleFlush]);

  const setDoc = useCallback(
    <K extends UserDocKey>(key: K, next: DocValueMap[K] | ((prev: DocValueMap[K]) => DocValueMap[K])) => {
      const previous = docsRef.current[key];
      const value = typeof next === "function" ? (next as (p: DocValueMap[K]) => DocValueMap[K])(previous) : next;
      if (value === previous) return;
      writeGenRef.current += 1; // mark a local edit so a racing refresh can't regress it
      docsRef.current = { ...docsRef.current, [key]: value };
      setDocsState(docsRef.current);
      persistDoc(key, value);
      enqueue({ kind: "doc", key }, DOC_FLUSH_DEBOUNCE_MS);
    },
    [enqueue, persistDoc]
  );

  // Push many ops onto the outbox with a single persist + flush (vs. enqueue's
  // one-at-a-time). The event state/cache is updated by the callers below before
  // this runs, so anon users still get the local mutation; only sync is batched.
  const enqueueMany = useCallback(
    (ops: OutboxOp[]) => {
      if (!userIdRef.current || !ops.length) return;
      outboxRef.current = coalesce([...outboxRef.current, ...ops]);
      persistOutbox();
      scheduleFlush(0);
    },
    [persistOutbox, scheduleFlush]
  );

  // Apply a patch map to the live state, cache, and outbox WITHOUT recording
  // undo history — the shared primitive behind every event mutation and behind
  // undo/redo themselves. A non-null value upserts (with a fresh updatedAt so the
  // write wins last-write-wins, including when re-applied by undo); null deletes.
  // Anon users still get the local mutation (enqueueMany no-ops without a user).
  const applyEventMap = useCallback(
    (map: PatchMap) => {
      writeGenRef.current += 1; // mark a local edit so a racing refresh can't regress it
      const next = { ...eventsRef.current };
      const ops: OutboxOp[] = [];
      for (const [id, value] of Object.entries(map)) {
        if (value) {
          next[id] = { ...value, updatedAt: Date.now() };
          ops.push({ kind: "eventUpsert", id });
        } else if (next[id]) {
          delete next[id];
          ops.push({ kind: "eventDelete", id });
        }
      }
      eventsRef.current = next;
      setEventsState(next);
      persistEvents(next);
      enqueueMany(ops);
    },
    [enqueueMany, persistEvents]
  );

  const pushUndo = useCallback((before: PatchMap, after: PatchMap) => {
    undoStackRef.current.push({ before, after });
    if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = []; // a fresh edit invalidates the redo branch
  }, []);

  // The single mutation primitive: upsert some events and delete others in one
  // atomic step (one render, one flush, one undo entry). Normalizes upserts and
  // ignores deletes of absent ids; an id in both upserts and removes is upserted.
  const commitEvents = useCallback(
    (upserts: CalendarEvent[], removes: string[]) => {
      const normalized = upserts
        .map((event) => normalizeCalendarEvent({ ...event, updatedAt: Date.now() }))
        .filter((event): event is CalendarEvent => event != null);
      const upsertIds = new Set(normalized.map((event) => event.id));
      const presentRemoves = removes.filter((id) => eventsRef.current[id] && !upsertIds.has(id));
      if (!normalized.length && !presentRemoves.length) return;

      const before: PatchMap = {};
      const after: PatchMap = {};
      for (const event of normalized) {
        before[event.id] = eventsRef.current[event.id] ?? null;
        after[event.id] = event;
      }
      for (const id of presentRemoves) {
        before[id] = eventsRef.current[id] ?? null;
        after[id] = null;
      }
      applyEventMap(after);
      pushUndo(before, after);
    },
    [applyEventMap, pushUndo]
  );

  const undo = useCallback(() => {
    const patch = undoStackRef.current.pop();
    if (!patch) return false;
    applyEventMap(patch.before);
    redoStackRef.current.push(patch);
    return true;
  }, [applyEventMap]);

  const redo = useCallback(() => {
    const patch = redoStackRef.current.pop();
    if (!patch) return false;
    applyEventMap(patch.after);
    undoStackRef.current.push(patch);
    return true;
  }, [applyEventMap]);

  // The public mutations are thin wrappers over commitEvents, so each records one
  // undo entry and the four share one optimistic/sync path.
  const upsertEvent = useCallback((event: CalendarEvent) => commitEvents([event], []), [commitEvents]);
  const removeEvent = useCallback((id: string) => commitEvents([], [id]), [commitEvents]);
  const upsertEvents = useCallback(
    (incoming: CalendarEvent[]) => commitEvents(incoming, []),
    [commitEvents]
  );
  const removeEvents = useCallback((ids: string[]) => commitEvents([], ids), [commitEvents]);

  // Live refresh: a focused, signed-in tab pulls server-side changes (another
  // device, or an agent writing straight to the database) without a manual
  // reload, through the same optimistic refs/setters so a pending edit is safe.
  useLiveSync({
    userId, scopeRef, userIdRef, bootstrappedRef, authBlockedRef, outboxRef,
    eventsRef, docsRef, writeGenRef, lastVersionRef,
    setEvents: setEventsState, setDocs: setDocsState, persistEvents, persistDoc, setStatus,
  });

  return {
    status,
    pendingCount,
    hasLoaded,
    syncError,
    docs,
    setDoc,
    events,
    upsertEvent,
    removeEvent,
    upsertEvents,
    removeEvents,
    commitEvents,
    undo,
    redo,
  };
}
