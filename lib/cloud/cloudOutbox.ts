// Pending-write queue for cloud sync. Pure data + helpers (no React, no
// fetch) so retry/coalescing semantics are unit-testable. Doc ops are dirty
// flags — the latest value is read from the store at flush time — so multiple
// writes to one key coalesce to a single PUT. Event ops coalesce to the
// latest operation per event id (an upsert followed by a delete is just a
// delete; a delete followed by a re-create is just an upsert).

import { isUserDocKey, type UserDocKey } from "./userDataDocs";

export type OutboxOp =
  | { kind: "doc"; key: UserDocKey }
  | { kind: "eventUpsert"; id: string }
  | { kind: "eventDelete"; id: string };

export function coalesce(ops: OutboxOp[]): OutboxOp[] {
  const docSeen = new Set<UserDocKey>();
  const latestEventOp = new Map<string, "eventUpsert" | "eventDelete">();
  const order: Array<{ type: "doc"; key: UserDocKey } | { type: "event"; id: string }> = [];

  for (const op of ops) {
    if (op.kind === "doc") {
      if (!docSeen.has(op.key)) {
        docSeen.add(op.key);
        order.push({ type: "doc", key: op.key });
      }
    } else {
      if (!latestEventOp.has(op.id)) order.push({ type: "event", id: op.id });
      latestEventOp.set(op.id, op.kind);
    }
  }

  return order.map((entry) =>
    entry.type === "doc"
      ? ({ kind: "doc", key: entry.key } as OutboxOp)
      : ({ kind: latestEventOp.get(entry.id)!, id: entry.id } as OutboxOp)
  );
}

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

export function nextRetryDelayMs(attempt: number): number {
  const index = Math.min(Math.max(Math.floor(attempt), 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

export function serializeOutbox(ops: OutboxOp[]): string {
  return JSON.stringify(ops);
}

export function parseOutbox(raw: string | null): OutboxOp[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ops: OutboxOp[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const op = item as Record<string, unknown>;
    if (op.kind === "doc" && isUserDocKey(op.key)) {
      ops.push({ kind: "doc", key: op.key });
    } else if (
      (op.kind === "eventUpsert" || op.kind === "eventDelete") &&
      typeof op.id === "string" &&
      op.id
    ) {
      ops.push({ kind: op.kind, id: op.id });
    }
  }
  return ops;
}
