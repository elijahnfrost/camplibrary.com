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
import { normalizeCalendarEvent, normalizeCalendarEventList, type CalendarEvent } from "./calendar/types";
import { MIGRATION_MARKER_KEY, collectLocalDocsForImport } from "./cloudMigration";
import { coalesce, nextRetryDelayMs, parseOutbox, serializeOutbox, type OutboxOp } from "./cloudOutbox";
import { scopedStorageKey } from "./storageScope";
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

export type SyncStatus = "local" | "syncing" | "synced" | "offline";

type Docs = { [K in UserDocKey]: DocValueMap[K] };

export interface CloudUserData {
  status: SyncStatus;
  pendingCount: number;
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

type SendResult = "done" | "retry" | "auth";

export function useCloudUserData(userId: string | null): CloudUserData {
  const scope = userId ? "user:" + userId : "anon";

  const [docs, setDocsState] = useState<Docs>(defaultDocs);
  const [events, setEventsState] = useState<Record<string, CalendarEvent>>({});
  const [status, setStatus] = useState<SyncStatus>(userId ? "syncing" : "local");
  const [pendingCount, setPendingCount] = useState(0);

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
    // Other 4xx: a poison op would block the queue forever — drop it.
    return "done";
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
    if (flushingRef.current || !userIdRef.current || authBlockedRef.current) return;
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
      // Not invite-accepted, or backend unconfigured: run in local mode.
      authBlockedRef.current = response.status !== 503;
      setStatus("local");
      return;
    }
    if (!response.ok) {
      setStatus("offline");
      attemptRef.current += 1;
      window.setTimeout(() => void bootstrapRef.current(), nextRetryDelayMs(attemptRef.current));
      return;
    }
    if (scopeRef.current !== currentScope) return; // signed out mid-flight

    let body: { docs?: Record<string, unknown>; events?: unknown } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      body = {};
    }

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
    const dirtyDocKeys = new Set(
      outboxRef.current.filter((op): op is Extract<OutboxOp, { kind: "doc" }> => op.kind === "doc").map((op) => op.key)
    );
    const serverDocs = body.docs && typeof body.docs === "object" ? body.docs : {};
    const nextDocs = { ...docsRef.current };
    for (const key of USER_DOC_KEYS) {
      if (dirtyDocKeys.has(key) || importedKeys.includes(key)) continue;
      if (key in serverDocs) {
        (nextDocs as Record<string, unknown>)[key] = normalizeDoc(key, (serverDocs as Record<string, unknown>)[key]);
      }
      persistDoc(key, (nextDocs as Record<string, unknown>)[key]);
    }
    docsRef.current = nextDocs;
    setDocsState(nextDocs);

    // Server events replace local state — except ids with pending ops.
    const pendingEventIds = new Set(
      outboxRef.current
        .filter((op): op is Exclude<OutboxOp, { kind: "doc" }> => op.kind !== "doc")
        .map((op) => op.id)
    );
    const nextEvents: Record<string, CalendarEvent> = {};
    if (Array.isArray(body.events)) {
      for (const raw of body.events) {
        const event = normalizeCalendarEvent(raw);
        if (event && !pendingEventIds.has(event.id)) nextEvents[event.id] = event;
      }
    }
    for (const id of pendingEventIds) {
      const local = eventsRef.current[id];
      if (local) nextEvents[id] = local;
    }
    eventsRef.current = nextEvents;
    setEventsState(nextEvents);
    persistEvents(nextEvents);

    bootstrappedRef.current = true;
    attemptRef.current = 0;
    if (outboxRef.current.length) {
      scheduleFlush(0);
    } else {
      setStatus("synced");
    }
  }, [persistDoc, persistEvents, scheduleFlush]);

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

    bootstrappedRef.current = false;
    authBlockedRef.current = false;
    attemptRef.current = 0;
    setStatus(userId ? "syncing" : "local");
    if (userId) void bootstrapRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Reconnect triggers: flush (or re-bootstrap) when the network returns or
  // the tab becomes visible again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onWake = () => {
      if (!userIdRef.current || authBlockedRef.current) return;
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
      docsRef.current = { ...docsRef.current, [key]: value };
      setDocsState(docsRef.current);
      persistDoc(key, value);
      enqueue({ kind: "doc", key }, DOC_FLUSH_DEBOUNCE_MS);
    },
    [enqueue, persistDoc]
  );

  const upsertEvent = useCallback(
    (event: CalendarEvent) => {
      const normalized = normalizeCalendarEvent({ ...event, updatedAt: Date.now() });
      if (!normalized) return;
      eventsRef.current = { ...eventsRef.current, [normalized.id]: normalized };
      setEventsState(eventsRef.current);
      persistEvents(eventsRef.current);
      enqueue({ kind: "eventUpsert", id: normalized.id }, 0);
    },
    [enqueue, persistEvents]
  );

  const removeEvent = useCallback(
    (id: string) => {
      if (!eventsRef.current[id]) return;
      const next = { ...eventsRef.current };
      delete next[id];
      eventsRef.current = next;
      setEventsState(next);
      persistEvents(next);
      enqueue({ kind: "eventDelete", id }, 0);
    },
    [enqueue, persistEvents]
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

  const upsertEvents = useCallback(
    (incoming: CalendarEvent[]) => {
      const normalized = incoming
        .map((event) => normalizeCalendarEvent({ ...event, updatedAt: Date.now() }))
        .filter((event): event is CalendarEvent => event != null);
      if (!normalized.length) return;
      const next = { ...eventsRef.current };
      for (const event of normalized) next[event.id] = event;
      eventsRef.current = next;
      setEventsState(next);
      persistEvents(next);
      enqueueMany(normalized.map((event) => ({ kind: "eventUpsert", id: event.id })));
    },
    [enqueueMany, persistEvents]
  );

  const removeEvents = useCallback(
    (ids: string[]) => {
      const present = ids.filter((id) => eventsRef.current[id]);
      if (!present.length) return;
      const next = { ...eventsRef.current };
      for (const id of present) delete next[id];
      eventsRef.current = next;
      setEventsState(next);
      persistEvents(next);
      enqueueMany(present.map((id) => ({ kind: "eventDelete", id })));
    },
    [enqueueMany, persistEvents]
  );

  return { status, pendingCount, docs, setDoc, events, upsertEvent, removeEvent, upsertEvents, removeEvents };
}
