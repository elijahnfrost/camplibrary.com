import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { getSql } from "./db";
import { getRequiredServerEnv } from "./env";
import { ensureUserDataSchema } from "./userData";

// Subscribable .ics feed tokens. A feed URL is a secret address (like Google's
// own private iCal address): the calendar client fetches it server-side with no
// cookies, so the unguessable token IS the credential. We look the token up by
// its HMAC digest (a keyed-hash equality on a UNIQUE index — no enumeration, no
// timing oracle) and ALSO keep a reversibly-encrypted copy so an owner can
// re-copy their feed URL later. Mirrors the invite-code subsystem's crypto.

export type CalendarFeedRecord = {
  id: string;
  campId: string | null;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

// A stored record plus the decrypted raw token (when recoverable), for callers
// that need to rebuild the subscribe URL. Never sent to the browser as-is — the
// route maps `token` into URLs and drops it.
export type CalendarFeedRecordWithToken = CalendarFeedRecord & { token: string | null };

const TOKEN_BYTES = 32; // 256 bits of entropy → base64url is 43 chars.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const FEED_LABEL_MAX_LENGTH = 120;
const FEED_CAMP_ID_MAX_LENGTH = 120;

export function generateFeedToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

// Keyed hash of the raw token, domain-separated from invite-code digests so a
// feed token can never collide with (or be confused for) an invite code even
// though both are keyed with the same secret.
function feedTokenDigest(rawToken: string): string {
  return createHmac("sha256", getRequiredServerEnv("INVITE_CODE_SECRET"))
    .update("calfeed:" + rawToken)
    .digest("hex");
}

// AES-256-GCM at-rest encryption of the raw token so the owner can re-copy the
// feed URL after creation. The key is DERIVED from INVITE_CODE_SECRET and
// domain-separated from the digest use above, so a DB leak ALONE can't recover a
// token (the app secret is also required) — keeping most of the digest-only
// guarantee while restoring a persistent "copy link" affordance.
const ENC_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function tokenEncryptionKey(): Buffer {
  return createHash("sha256")
    .update("calfeed-enc:" + getRequiredServerEnv("INVITE_CODE_SECRET"))
    .digest();
}

export function encryptToken(rawToken: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(rawToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

// Returns null for any non-recoverable blob (legacy row, wrong key, tampered
// ciphertext) — the caller simply offers no copy link for that feed.
export function decryptToken(blob: unknown): string | null {
  if (typeof blob !== "string") return null;
  const sep = blob.indexOf(":");
  if (sep < 0 || blob.slice(0, sep) !== ENC_VERSION) return null;
  try {
    const buf = Buffer.from(blob.slice(sep + 1), "base64");
    if (buf.length <= IV_BYTES + TAG_BYTES) return null;
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (!label) return null;
  return label.slice(0, FEED_LABEL_MAX_LENGTH);
}

function normalizeCampId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const campId = value.trim();
  if (!campId) return null;
  return campId.slice(0, FEED_CAMP_ID_MAX_LENGTH);
}

function mapRecord(row: Record<string, unknown>): CalendarFeedRecord {
  return {
    id: String(row.id),
    campId: row.camp_id == null ? null : String(row.camp_id),
    label: row.label == null ? null : String(row.label),
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastUsedAt: row.last_used_at == null ? null : new Date(String(row.last_used_at)).toISOString(),
    revokedAt: row.revoked_at == null ? null : new Date(String(row.revoked_at)).toISOString(),
  };
}

async function createCalendarFeedToken({
  clerkUserId,
  campId,
  label,
}: {
  clerkUserId: string;
  campId?: unknown;
  label?: unknown;
}): Promise<{ token: string; record: CalendarFeedRecord }> {
  await ensureUserDataSchema();
  const sql = getSql();
  const normalizedCampId = normalizeCampId(campId);
  const normalizedLabel = normalizeLabel(label);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateFeedToken();
    try {
      const rows = await sql`
        INSERT INTO calendar_feed_tokens (id, clerk_user_id, token_hash, token_enc, camp_id, label)
        VALUES (${randomUUID()}, ${clerkUserId}, ${feedTokenDigest(token)}, ${encryptToken(token)}, ${normalizedCampId}, ${normalizedLabel})
        RETURNING id, camp_id, label, created_at, last_used_at, revoked_at
      `;
      return { token, record: mapRecord(rows[0]) };
    } catch (error) {
      // Retry only on the (astronomically unlikely) token-hash collision.
      if (attempt === 4) throw error;
    }
  }
  throw new Error("Unable to create calendar feed token");
}

// Get-or-create THE feed for a (user, camp) pair. The product model is exactly
// one live feed per camp — never a second — so an existing active feed is
// returned with its decrypted token, any stray duplicates for the same camp are
// revoked (the data converges to one), and a legacy row whose token predates
// encryption (undecryptable) is rotated out for a fresh, copyable one.
// `forceNew` revokes the current feed and mints a new secret (the "Reset link"
// action), so a link shared too widely can be rotated.
export async function ensureCalendarFeedToken({
  clerkUserId,
  campId,
  label,
  forceNew = false,
}: {
  clerkUserId: string;
  campId?: unknown;
  label?: unknown;
  forceNew?: boolean;
}): Promise<{ token: string; record: CalendarFeedRecord }> {
  await ensureUserDataSchema();
  const sql = getSql();
  const normalizedCampId = normalizeCampId(campId);

  if (forceNew) {
    await sql`
      UPDATE calendar_feed_tokens SET revoked_at = now()
      WHERE clerk_user_id = ${clerkUserId}
        AND revoked_at IS NULL
        AND camp_id IS NOT DISTINCT FROM ${normalizedCampId}
    `;
    return createCalendarFeedToken({ clerkUserId, campId: normalizedCampId, label });
  }

  const rows = await sql`
    SELECT id, camp_id, label, created_at, last_used_at, revoked_at, token_enc
    FROM calendar_feed_tokens
    WHERE clerk_user_id = ${clerkUserId}
      AND revoked_at IS NULL
      AND camp_id IS NOT DISTINCT FROM ${normalizedCampId}
    ORDER BY created_at DESC
  `;

  // Converge to one: revoke any extra active feeds for this camp (legacy dups).
  const extras = rows.slice(1).map((row) => String(row.id));
  if (extras.length) {
    await sql`UPDATE calendar_feed_tokens SET revoked_at = now() WHERE id = ANY(${extras})`;
  }

  const primary = rows[0];
  if (primary) {
    const token = decryptToken(primary.token_enc);
    if (token) return { token, record: mapRecord(primary as Record<string, unknown>) };
    // Token predates encryption → we can't reveal it; retire it and mint anew.
    await sql`UPDATE calendar_feed_tokens SET revoked_at = now() WHERE id = ${String(primary.id)}`;
  }

  return createCalendarFeedToken({ clerkUserId, campId: normalizedCampId, label });
}

export async function listCalendarFeedTokens(
  clerkUserId: string
): Promise<CalendarFeedRecordWithToken[]> {
  await ensureUserDataSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, camp_id, label, created_at, last_used_at, revoked_at, token_enc
    FROM calendar_feed_tokens
    WHERE clerk_user_id = ${clerkUserId}
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return { ...mapRecord(record), token: decryptToken(record.token_enc) };
  });
}

// Soft-delete: keeps the audit row and guarantees the token can never resolve
// again. Scoped to the owner so one user can't revoke another's feed.
export async function revokeCalendarFeedToken(clerkUserId: string, id: string): Promise<boolean> {
  await ensureUserDataSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE calendar_feed_tokens
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE id = ${id} AND clerk_user_id = ${clerkUserId}
    RETURNING id
  `;
  return rows.length === 1;
}

// Public lookup for the feed/run-sheet routes. Single indexed equality on a
// keyed hash — an attacker can't forge a valid digest without the token, so no
// enumeration or timing oracle is possible. Returns null for unknown/revoked.
export async function resolveCalendarFeedToken(
  rawToken: string
): Promise<{ clerkUserId: string; campId: string | null } | null> {
  if (!TOKEN_PATTERN.test(rawToken)) return null;
  await ensureUserDataSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, clerk_user_id, camp_id
    FROM calendar_feed_tokens
    WHERE token_hash = ${feedTokenDigest(rawToken)} AND revoked_at IS NULL
    LIMIT 1
  `;
  if (!rows.length) return null;
  const row = rows[0];
  // Fire-and-forget freshness stamp — never block the feed response on it.
  void sql`
    UPDATE calendar_feed_tokens SET last_used_at = now() WHERE id = ${String(row.id)}
  `.catch(() => {});
  return { clerkUserId: String(row.clerk_user_id), campId: row.camp_id == null ? null : String(row.camp_id) };
}
