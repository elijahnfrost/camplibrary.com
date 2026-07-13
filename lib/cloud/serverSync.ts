// Pure merge helpers shared by the cloud bootstrap and the live-refresh poll.
//
// Both paths reconcile a server snapshot against the client's live state under
// the same rule: server truth wins EXCEPT for anything the client is still
// trying to save (a doc key with a pending edit, an event id with a pending
// op). Keeping the reconciliation here — free of React, fetch, and localStorage
// — makes the last-write-wins semantics unit-testable and guarantees the cold
// bootstrap and the background refresh can never drift apart.

import { normalizeCalendarEvent, type CalendarEvent } from "../calendar/types";
import { USER_DOC_KEYS, normalizeDoc, type DocValueMap, type UserDocKey } from "./userDataDocs";

export type Docs = { [K in UserDocKey]: DocValueMap[K] };

// Overlay server docs onto the current docs. A key in `skipKeys` (a pending
// local edit, or one just imported as canonical) keeps its local value; every
// other key adopts the server value when the server has one, else keeps its
// current value. Returns a fresh map — the caller persists and sets state.
export function mergeServerDocs(
  current: Docs,
  serverDocs: Record<string, unknown>,
  skipKeys: Set<UserDocKey>
): Docs {
  const next = { ...current };
  for (const key of USER_DOC_KEYS) {
    if (skipKeys.has(key)) continue;
    if (key in serverDocs) {
      (next as Record<string, unknown>)[key] = normalizeDoc(key, serverDocs[key]);
    }
  }
  return next;
}

// Rebuild the event map from a server snapshot. Server rows replace local state
// wholesale — so an event deleted on the server (e.g. by an agent writing
// straight to the database) drops out here — EXCEPT ids with a pending op,
// which keep their local value so an in-flight create/edit is never clobbered
// by a snapshot that predates it. Returns a fresh map.
export function mergeServerEvents(
  current: Record<string, CalendarEvent>,
  serverEvents: unknown,
  pendingIds: Set<string>
): Record<string, CalendarEvent> {
  const next: Record<string, CalendarEvent> = {};
  if (Array.isArray(serverEvents)) {
    for (const raw of serverEvents) {
      const event = normalizeCalendarEvent(raw);
      if (event && !pendingIds.has(event.id)) next[event.id] = event;
    }
  }
  for (const id of pendingIds) {
    const local = current[id];
    if (local) next[id] = local;
  }
  return next;
}
