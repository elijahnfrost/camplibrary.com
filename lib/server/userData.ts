import { getSql } from "./db";
import {
  isUserDocKey,
  normalizeDoc,
  type UserDocKey,
} from "@/lib/userDataDocs";

// Per-user cloud persistence: a (user, key) → jsonb document store mirroring
// the localStorage keys, plus calendar_events as a real table because events
// are mutated row-at-a-time (a drag is one UPDATE) and read by date range.
// Event payloads round-trip whole client objects; the server only extracts
// the columns it indexes, so new client-side event fields need no DDL.

export type StoredCalendarEvent = {
  id: string;
  date: string;
  startMin: number | null;
  endMin: number | null;
  title: string;
  activityId: string | null;
  kind: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type CalendarEventInput = {
  id: string;
  date: string;
  startMin: number | null;
  endMin: number | null;
  title: string;
  activityId: string | null;
  kind: string;
  payload: Record<string, unknown>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUTES_PER_DAY = 1440;

export const EVENT_TITLE_MAX_LENGTH = 200;
export const EVENT_ACTIVITY_ID_MAX_LENGTH = 120;

let schemaReady: Promise<void> | null = null;

export async function ensureUserDataSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`CREATE TABLE IF NOT EXISTS user_documents (
        clerk_user_id text NOT NULL,
        doc_key text NOT NULL,
        doc jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (clerk_user_id, doc_key)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS calendar_events (
        id uuid PRIMARY KEY,
        clerk_user_id text NOT NULL,
        event_date date NOT NULL,
        start_min integer,
        end_min integer,
        title text NOT NULL DEFAULT '',
        activity_id text,
        kind text NOT NULL DEFAULT 'custom',
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT calendar_events_minutes_check CHECK (
          (start_min IS NULL AND end_min IS NULL)
          OR (start_min >= 0 AND end_min <= 1440 AND start_min < end_min)
        )
      )`;
      await sql`
        CREATE INDEX IF NOT EXISTS calendar_events_user_date_idx
        ON calendar_events (clerk_user_id, event_date)
      `;
    })();
  }
  return schemaReady;
}

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// Pure, exported for tests. Accepts the whole client event object; extracts
// the indexed columns and keeps the full object as payload.
export function normalizeCalendarEventInput(
  raw: unknown
): { ok: true; event: CalendarEventInput } | { ok: false; reason: "invalid" } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "invalid" };
  const value = raw as Record<string, unknown>;

  if (typeof value.id !== "string" || !UUID_PATTERN.test(value.id)) return { ok: false, reason: "invalid" };
  if (!isValidDateKey(value.date)) return { ok: false, reason: "invalid" };

  const allDay = value.allDay === true;
  let startMin: number | null = null;
  let endMin: number | null = null;
  if (!allDay) {
    if (
      typeof value.startMin !== "number" ||
      typeof value.endMin !== "number" ||
      !Number.isInteger(value.startMin) ||
      !Number.isInteger(value.endMin) ||
      value.startMin < 0 ||
      value.endMin > MINUTES_PER_DAY ||
      value.startMin >= value.endMin
    ) {
      return { ok: false, reason: "invalid" };
    }
    startMin = value.startMin;
    endMin = value.endMin;
  }

  const title =
    typeof value.title === "string" ? value.title.trim().slice(0, EVENT_TITLE_MAX_LENGTH) : "";
  const activityId =
    typeof value.activityId === "string" && value.activityId
      ? value.activityId.slice(0, EVENT_ACTIVITY_ID_MAX_LENGTH)
      : null;
  const kind = value.kind === "activity" && activityId ? "activity" : "custom";

  return {
    ok: true,
    event: {
      id: value.id.toLowerCase(),
      date: value.date,
      startMin,
      endMin,
      title,
      activityId,
      kind,
      payload: value,
    },
  };
}

// Canonical columns win over whatever the payload snapshot says.
export function mapCalendarEventRow(row: Record<string, unknown>): StoredCalendarEvent {
  const payload = typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload)
    ? (row.payload as Record<string, unknown>)
    : {};
  const eventDate =
    row.event_date instanceof Date
      ? row.event_date.toISOString().slice(0, 10)
      : String(row.event_date).slice(0, 10);
  return {
    ...payload,
    id: String(row.id),
    date: eventDate,
    startMin: row.start_min == null ? null : Number(row.start_min),
    endMin: row.end_min == null ? null : Number(row.end_min),
    title: row.title == null ? "" : String(row.title),
    activityId: row.activity_id == null ? null : String(row.activity_id),
    kind: String(row.kind ?? "custom"),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function getUserDocs(clerkUserId: string): Promise<Partial<Record<UserDocKey, unknown>>> {
  await ensureUserDataSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT doc_key, doc FROM user_documents WHERE clerk_user_id = ${clerkUserId}
  `;
  const out: Partial<Record<UserDocKey, unknown>> = {};
  for (const row of rows) {
    const key = row.doc_key as string;
    if (isUserDocKey(key)) out[key] = normalizeDoc(key, row.doc);
  }
  return out;
}

export async function putUserDoc(
  clerkUserId: string,
  key: UserDocKey,
  rawDoc: unknown
): Promise<{ updatedAt: string }> {
  await ensureUserDataSchema();
  const sql = getSql();
  const doc = normalizeDoc(key, rawDoc);
  const rows = await sql`
    INSERT INTO user_documents (clerk_user_id, doc_key, doc)
    VALUES (${clerkUserId}, ${key}, ${sql.json(doc as never)})
    ON CONFLICT (clerk_user_id, doc_key)
    DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()
    RETURNING updated_at
  `;
  return { updatedAt: new Date(String(rows[0].updated_at)).toISOString() };
}

// One-time localStorage import: per-key INSERT ... DO NOTHING, so whichever
// device migrates first wins and re-runs are no-ops.
export async function importUserDocs(
  clerkUserId: string,
  docs: Partial<Record<UserDocKey, unknown>>
): Promise<{ imported: UserDocKey[]; skipped: UserDocKey[] }> {
  await ensureUserDataSchema();
  const sql = getSql();
  const imported: UserDocKey[] = [];
  const skipped: UserDocKey[] = [];
  for (const [key, raw] of Object.entries(docs)) {
    if (!isUserDocKey(key) || raw === undefined) continue;
    const doc = normalizeDoc(key, raw);
    const result = await sql`
      INSERT INTO user_documents (clerk_user_id, doc_key, doc)
      VALUES (${clerkUserId}, ${key}, ${sql.json(doc as never)})
      ON CONFLICT (clerk_user_id, doc_key) DO NOTHING
    `;
    (result.count > 0 ? imported : skipped).push(key);
  }
  return { imported, skipped };
}

export async function listCalendarEvents(
  clerkUserId: string,
  range?: { from?: string; to?: string }
): Promise<StoredCalendarEvent[]> {
  await ensureUserDataSchema();
  const sql = getSql();
  const from = range?.from && isValidDateKey(range.from) ? range.from : null;
  const to = range?.to && isValidDateKey(range.to) ? range.to : null;
  const rows = await sql`
    SELECT * FROM calendar_events
    WHERE clerk_user_id = ${clerkUserId}
    ${from ? sql`AND event_date >= ${from}` : sql``}
    ${to ? sql`AND event_date <= ${to}` : sql``}
    ORDER BY event_date, start_min NULLS FIRST
  `;
  return rows.map((row) => mapCalendarEventRow(row as Record<string, unknown>));
}

export async function upsertCalendarEvent(
  clerkUserId: string,
  raw: unknown
): Promise<{ ok: true; event: StoredCalendarEvent } | { ok: false; reason: "invalid" }> {
  const normalized = normalizeCalendarEventInput(raw);
  if (!normalized.ok) return normalized;
  await ensureUserDataSchema();
  const sql = getSql();
  const e = normalized.event;
  // The WHERE on the conflict arm is the ownership guard: an id owned by a
  // different user is never overwritten (the statement just affects 0 rows).
  const rows = await sql`
    INSERT INTO calendar_events (id, clerk_user_id, event_date, start_min, end_min, title, activity_id, kind, payload)
    VALUES (${e.id}, ${clerkUserId}, ${e.date}, ${e.startMin}, ${e.endMin}, ${e.title}, ${e.activityId}, ${e.kind}, ${sql.json(e.payload as never)})
    ON CONFLICT (id) DO UPDATE SET
      event_date = EXCLUDED.event_date,
      start_min = EXCLUDED.start_min,
      end_min = EXCLUDED.end_min,
      title = EXCLUDED.title,
      activity_id = EXCLUDED.activity_id,
      kind = EXCLUDED.kind,
      payload = EXCLUDED.payload,
      updated_at = now()
    WHERE calendar_events.clerk_user_id = ${clerkUserId}
    RETURNING *
  `;
  if (!rows.length) return { ok: false, reason: "invalid" };
  return { ok: true, event: mapCalendarEventRow(rows[0] as Record<string, unknown>) };
}

export async function deleteCalendarEvent(clerkUserId: string, id: string): Promise<boolean> {
  if (!UUID_PATTERN.test(id)) return false;
  await ensureUserDataSchema();
  const sql = getSql();
  await sql`
    DELETE FROM calendar_events WHERE id = ${id.toLowerCase()} AND clerk_user_id = ${clerkUserId}
  `;
  // Idempotent: deleting an already-gone event is success.
  return true;
}
