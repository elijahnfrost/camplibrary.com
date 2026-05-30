import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getSql } from "./db";
import { getRequiredServerEnv } from "./env";

export type InviteCodeRecord = {
  id: string;
  label: string | null;
  invitedEmail: string | null;
  status: "active" | "reserved" | "used" | "revoked";
  createdAt: string;
  expiresAt: string | null;
  reservedAt: string | null;
  reservedUntil: string | null;
  usedAt: string | null;
  usedByClerkUserId: string | null;
};

type ReserveResult =
  | { ok: true; reservationId: string; invitedEmail: string | null }
  | { ok: false; reason: "missing" | "invalid" | "email_mismatch" | "unavailable" | "expired" };

const RESERVATION_MINUTES = 30;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let schemaReady: Promise<void> | null = null;

export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function displayInviteCode(normalized: string): string {
  return normalized.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

function codeDigest(code: string): string {
  const normalized = normalizeInviteCode(code);
  return createHmac("sha256", getRequiredServerEnv("INVITE_CODE_SECRET")).update(normalized).digest("hex");
}

function randomCode(length = 12): string {
  let code = "";
  const bytes = randomBytes(length);
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return displayInviteCode(code);
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

export async function ensureInviteCodeSchema() {
  if (!schemaReady) {
    schemaReady = getSql()`CREATE TABLE IF NOT EXISTS invite_codes (
      id uuid PRIMARY KEY,
      code_hash text NOT NULL UNIQUE,
      label text,
      invited_email text,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz,
      reserved_at timestamptz,
      reserved_until timestamptz,
      reservation_id uuid,
      used_at timestamptz,
      used_by_clerk_user_id text,
      revoked_at timestamptz,
      CONSTRAINT invite_codes_status_check CHECK (status IN ('active', 'reserved', 'used', 'revoked'))
    )`.then(() => undefined);
  }
  return schemaReady;
}

function mapRecord(row: Record<string, unknown>): InviteCodeRecord {
  return {
    id: String(row.id),
    label: row.label == null ? null : String(row.label),
    invitedEmail: row.invited_email == null ? null : String(row.invited_email),
    status: row.status as InviteCodeRecord["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: row.expires_at == null ? null : new Date(String(row.expires_at)).toISOString(),
    reservedAt: row.reserved_at == null ? null : new Date(String(row.reserved_at)).toISOString(),
    reservedUntil: row.reserved_until == null ? null : new Date(String(row.reserved_until)).toISOString(),
    usedAt: row.used_at == null ? null : new Date(String(row.used_at)).toISOString(),
    usedByClerkUserId: row.used_by_clerk_user_id == null ? null : String(row.used_by_clerk_user_id),
  };
}

export async function createInviteCode({
  label,
  invitedEmail,
  expiresAt,
}: {
  label?: string;
  invitedEmail?: string;
  expiresAt?: string | null;
}) {
  await ensureInviteCodeSchema();
  const sql = getSql();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      const rows = await sql`
        INSERT INTO invite_codes (id, code_hash, label, invited_email, expires_at)
        VALUES (
          ${randomUUID()},
          ${codeDigest(code)},
          ${label?.trim() || null},
          ${invitedEmail?.trim().toLowerCase() || null},
          ${expiresAt ? new Date(expiresAt) : null}
        )
        RETURNING id, label, invited_email, status, created_at, expires_at, reserved_at, reserved_until, used_at, used_by_clerk_user_id
      `;
      return { code, record: mapRecord(rows[0]) };
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }

  throw new Error("Unable to create invite code");
}

export async function reserveInviteCode({
  code,
  email,
}: {
  code: string;
  email?: string;
}): Promise<ReserveResult> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return { ok: false, reason: "missing" };

  await ensureInviteCodeSchema();
  const sql = getSql();
  const digest = codeDigest(normalized);
  const reservationId = randomUUID();
  const rows = await sql.begin(async (tx) => {
    const found = await tx`
      SELECT id, invited_email, status, expires_at, reserved_until
      FROM invite_codes
      WHERE code_hash = ${digest}
      FOR UPDATE
    `;
    if (!found.length) return [];
    const item = found[0];
    const now = Date.now();
    const expiresAt = item.expires_at ? new Date(String(item.expires_at)).getTime() : null;
    const reservedUntil = item.reserved_until ? new Date(String(item.reserved_until)).getTime() : null;
    const invitedEmail = item.invited_email == null ? null : String(item.invited_email).toLowerCase();
    const providedEmail = email?.trim().toLowerCase() || null;

    if (expiresAt != null && expiresAt < now) return [{ failure_reason: "expired" }];
    if (invitedEmail && providedEmail && invitedEmail !== providedEmail) return [{ failure_reason: "email_mismatch" }];
    if (item.status === "used" || item.status === "revoked") return [{ failure_reason: "unavailable" }];
    if (item.status === "reserved" && reservedUntil != null && reservedUntil > now) {
      return [{ failure_reason: "unavailable" }];
    }

    return tx`
      UPDATE invite_codes
      SET status = 'reserved',
          reservation_id = ${reservationId},
          reserved_at = now(),
          reserved_until = now() + (${RESERVATION_MINUTES} || ' minutes')::interval
      WHERE id = ${item.id}
      RETURNING invited_email
    `;
  });

  if (!rows.length) return { ok: false, reason: "invalid" };
  const failureReason = rows[0].failure_reason;
  if (failureReason) return { ok: false, reason: failureReason as "email_mismatch" | "unavailable" | "expired" };
  const row = rows[0] as { invited_email: string | null };

  return {
    ok: true,
    reservationId,
    invitedEmail: row.invited_email == null ? null : String(row.invited_email),
  };
}

export async function consumeInviteCode({
  code,
  reservationId,
  clerkUserId,
  userEmail,
}: {
  code: string;
  reservationId: string;
  clerkUserId: string;
  userEmail?: string | null;
}) {
  await ensureInviteCodeSchema();
  const normalized = normalizeInviteCode(code);
  if (!normalized || !reservationId || !clerkUserId) return false;

  const sql = getSql();
  const normalizedEmail = userEmail?.trim().toLowerCase() || null;
  const rows = await sql`
    UPDATE invite_codes
    SET status = 'used',
        used_at = now(),
        used_by_clerk_user_id = ${clerkUserId},
        reserved_until = null
    WHERE code_hash = ${codeDigest(normalized)}
      AND reservation_id = ${reservationId}
      AND status = 'reserved'
      AND reserved_until > now()
      AND (invited_email IS NULL OR invited_email = ${normalizedEmail})
    RETURNING id
  `;

  if (rows.length === 1) return true;

  const existing = await sql`
    SELECT id
    FROM invite_codes
    WHERE code_hash = ${codeDigest(normalized)}
      AND reservation_id = ${reservationId}
      AND status = 'used'
      AND used_by_clerk_user_id = ${clerkUserId}
      AND (invited_email IS NULL OR invited_email = ${normalizedEmail})
    LIMIT 1
  `;
  return existing.length === 1;
}

export async function listInviteCodes() {
  await ensureInviteCodeSchema();
  const rows = await getSql()`
    SELECT id, label, invited_email, status, created_at, expires_at, reserved_at, reserved_until, used_at, used_by_clerk_user_id
    FROM invite_codes
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return rows.map(mapRecord);
}

export function isValidInviteAdminToken(value: string | null): boolean {
  const expected = process.env.INVITE_CODE_ADMIN_TOKEN;
  if (!expected || expected.trim().length < 32 || !value) return false;
  return safeEqual(value, expected);
}
