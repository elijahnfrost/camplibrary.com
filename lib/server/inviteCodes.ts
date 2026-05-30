import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getSql } from "./db";
import { getRequiredServerEnv } from "./env";

export type InviteCodeRecord = {
  id: string;
  label: string | null;
  invitedEmail: string | null;
  status: "active" | "reserved" | "used" | "revoked";
  active: boolean;
  usageCount: number;
  maxUses: number;
  createdAt: string;
  expiresAt: string | null;
  reservedAt: string | null;
  reservedUntil: string | null;
  usedAt: string | null;
  usedByClerkUserId: string | null;
  revokedAt: string | null;
  deactivatedAt: string | null;
};

type ReserveResult =
  | { ok: true; reservationId: string; invitedEmail: string | null }
  | { ok: false; reason: "missing" | "invalid" | "email_mismatch" | "unavailable" | "expired" };

type DeactivateResult =
  | { ok: true; record: InviteCodeRecord }
  | { ok: false; reason: "missing" | "invalid" | "not_found" | "used" };

const RESERVATION_MINUTES = 30;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_INVITE_USES = 2147483647;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function normalizeInviteMaxUses(value: unknown): number {
  const maxUses = value == null || value === "" ? 1 : Number(value);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_INVITE_USES) {
    throw new Error("Invite max uses must be a positive integer.");
  }
  return maxUses;
}

export async function ensureInviteCodeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`CREATE TABLE IF NOT EXISTS invite_codes (
        id uuid PRIMARY KEY,
        code_hash text NOT NULL UNIQUE,
        label text,
        invited_email text,
        status text NOT NULL DEFAULT 'active',
        active boolean NOT NULL DEFAULT true,
        usage_count integer NOT NULL DEFAULT 0,
        max_uses integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz,
        reserved_at timestamptz,
        reserved_until timestamptz,
        reservation_id uuid,
        used_at timestamptz,
        used_by_clerk_user_id text,
        revoked_at timestamptz,
        deactivated_at timestamptz,
        CONSTRAINT invite_codes_status_check CHECK (status IN ('active', 'reserved', 'used', 'revoked')),
        CONSTRAINT invite_codes_usage_count_check CHECK (usage_count >= 0),
        CONSTRAINT invite_codes_max_uses_check CHECK (max_uses > 0),
        CONSTRAINT invite_codes_usage_limit_check CHECK (usage_count <= max_uses)
      )`;
      await sql`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS active boolean DEFAULT true`;
      await sql`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS usage_count integer DEFAULT 0`;
      await sql`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS max_uses integer DEFAULT 1`;
      await sql`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS deactivated_at timestamptz`;
      await sql`
        UPDATE invite_codes
        SET usage_count = CASE WHEN status = 'used' AND COALESCE(usage_count, 0) = 0 THEN 1 ELSE COALESCE(usage_count, 0) END,
            max_uses = GREATEST(COALESCE(max_uses, 1), 1),
            active = CASE
              WHEN status IN ('used', 'revoked') THEN false
              WHEN COALESCE(usage_count, 0) >= GREATEST(COALESCE(max_uses, 1), 1) THEN false
              ELSE COALESCE(active, true)
            END,
            deactivated_at = CASE
              WHEN (
                status IN ('used', 'revoked')
                OR COALESCE(usage_count, 0) >= GREATEST(COALESCE(max_uses, 1), 1)
              )
              THEN COALESCE(deactivated_at, used_at, revoked_at, now())
              ELSE deactivated_at
            END
        WHERE usage_count IS NULL
          OR max_uses IS NULL
          OR active IS NULL
          OR (status = 'used' AND usage_count = 0)
          OR (status IN ('used', 'revoked') AND active = true)
          OR (usage_count >= max_uses AND active = true)
      `;
      await sql`ALTER TABLE invite_codes ALTER COLUMN active SET DEFAULT true`;
      await sql`ALTER TABLE invite_codes ALTER COLUMN active SET NOT NULL`;
      await sql`ALTER TABLE invite_codes ALTER COLUMN usage_count SET DEFAULT 0`;
      await sql`ALTER TABLE invite_codes ALTER COLUMN usage_count SET NOT NULL`;
      await sql`ALTER TABLE invite_codes ALTER COLUMN max_uses SET DEFAULT 1`;
      await sql`ALTER TABLE invite_codes ALTER COLUMN max_uses SET NOT NULL`;
      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'invite_codes_usage_count_check'
              AND conrelid = 'invite_codes'::regclass
          ) THEN
            ALTER TABLE invite_codes ADD CONSTRAINT invite_codes_usage_count_check CHECK (usage_count >= 0);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'invite_codes_max_uses_check'
              AND conrelid = 'invite_codes'::regclass
          ) THEN
            ALTER TABLE invite_codes ADD CONSTRAINT invite_codes_max_uses_check CHECK (max_uses > 0);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'invite_codes_usage_limit_check'
              AND conrelid = 'invite_codes'::regclass
          ) THEN
            ALTER TABLE invite_codes ADD CONSTRAINT invite_codes_usage_limit_check CHECK (usage_count <= max_uses);
          END IF;
        END $$;
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS invite_code_reservations (
          id uuid PRIMARY KEY,
          invite_code_id uuid NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,
          reservation_id uuid NOT NULL UNIQUE,
          email text,
          clerk_user_id text,
          status text NOT NULL DEFAULT 'reserved',
          reserved_at timestamptz NOT NULL DEFAULT now(),
          reserved_until timestamptz NOT NULL,
          used_at timestamptz,
          CONSTRAINT invite_code_reservations_status_check CHECK (status IN ('reserved', 'used', 'revoked'))
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS invite_code_reservations_invite_code_id_idx
        ON invite_code_reservations (invite_code_id)
      `;
    })();
  }
  return schemaReady;
}

function mapRecord(row: Record<string, unknown>): InviteCodeRecord {
  return {
    id: String(row.id),
    label: row.label == null ? null : String(row.label),
    invitedEmail: row.invited_email == null ? null : String(row.invited_email),
    status: row.status as InviteCodeRecord["status"],
    active: row.active == null ? row.status !== "used" && row.status !== "revoked" : Boolean(row.active),
    usageCount: Number(row.usage_count ?? 0),
    maxUses: Number(row.max_uses ?? 1),
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: row.expires_at == null ? null : new Date(String(row.expires_at)).toISOString(),
    reservedAt: row.reserved_at == null ? null : new Date(String(row.reserved_at)).toISOString(),
    reservedUntil: row.reserved_until == null ? null : new Date(String(row.reserved_until)).toISOString(),
    usedAt: row.used_at == null ? null : new Date(String(row.used_at)).toISOString(),
    usedByClerkUserId: row.used_by_clerk_user_id == null ? null : String(row.used_by_clerk_user_id),
    revokedAt: row.revoked_at == null ? null : new Date(String(row.revoked_at)).toISOString(),
    deactivatedAt: row.deactivated_at == null ? null : new Date(String(row.deactivated_at)).toISOString(),
  };
}

export async function createInviteCode({
  label,
  invitedEmail,
  expiresAt,
  maxUses,
}: {
  label?: string;
  invitedEmail?: string;
  expiresAt?: string | null;
  maxUses?: number;
}) {
  await ensureInviteCodeSchema();
  const sql = getSql();
  const normalizedMaxUses = normalizeInviteMaxUses(maxUses);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      const rows = await sql`
        INSERT INTO invite_codes (id, code_hash, label, invited_email, expires_at, max_uses)
        VALUES (
          ${randomUUID()},
          ${codeDigest(code)},
          ${label?.trim() || null},
          ${invitedEmail?.trim().toLowerCase() || null},
          ${expiresAt ? new Date(expiresAt) : null},
          ${normalizedMaxUses}
        )
        RETURNING id, label, invited_email, status, active, usage_count, max_uses, created_at, expires_at, reserved_at, reserved_until, used_at, used_by_clerk_user_id, revoked_at, deactivated_at
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
      SELECT id, invited_email, status, active, expires_at, reserved_until, usage_count, max_uses
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
    const usageCount = Number(item.usage_count ?? 0);
    const maxUses = Number(item.max_uses ?? 1);

    if (expiresAt != null && expiresAt < now) return [{ failure_reason: "expired" }];
    if (invitedEmail && providedEmail && invitedEmail !== providedEmail) return [{ failure_reason: "email_mismatch" }];
    if (item.status === "used" || item.status === "revoked") return [{ failure_reason: "unavailable" }];
    if (!item.active || usageCount >= maxUses) {
      await tx`
        UPDATE invite_codes
        SET status = CASE WHEN status = 'revoked' THEN 'revoked' ELSE 'used' END,
            active = false,
            deactivated_at = COALESCE(deactivated_at, used_at, revoked_at, now()),
            reserved_until = null
        WHERE id = ${item.id}
          AND active = true
          AND usage_count >= max_uses
      `;
      return [{ failure_reason: "unavailable" }];
    }

    const activeReservations = await tx`
      SELECT count(*)::int AS count
      FROM invite_code_reservations
      WHERE invite_code_id = ${item.id}
        AND status = 'reserved'
        AND reserved_until > now()
    `;
    const activeReservationCount = Number(activeReservations[0]?.count ?? 0);
    const hasLegacyReservation = item.status === "reserved" && reservedUntil != null && reservedUntil > now;
    if (usageCount + activeReservationCount >= maxUses || (maxUses === 1 && hasLegacyReservation)) {
      return [{ failure_reason: "unavailable" }];
    }

    await tx`
      INSERT INTO invite_code_reservations (
        id,
        invite_code_id,
        reservation_id,
        email,
        reserved_until
      )
      VALUES (
        ${randomUUID()},
        ${item.id},
        ${reservationId},
        ${providedEmail},
        now() + (${RESERVATION_MINUTES} || ' minutes')::interval
      )
    `;

    return tx`
      UPDATE invite_codes
      SET status = ${maxUses === 1 ? "reserved" : "active"},
          reservation_id = ${reservationId},
          reserved_at = now(),
          reserved_until = now() + (${RESERVATION_MINUTES} || ' minutes')::interval
      WHERE id = ${item.id}
        AND active = true
        AND usage_count < max_uses
        AND status IN ('active', 'reserved')
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
  const digest = codeDigest(normalized);
  const rows = await sql.begin(async (tx) => {
    const found = await tx`
      SELECT
        invite_codes.id,
        invite_codes.invited_email,
        invite_codes.status AS invite_status,
        invite_codes.active,
        invite_codes.expires_at,
        invite_codes.usage_count,
        invite_codes.max_uses,
        invite_code_reservations.id AS reservation_row_id,
        invite_code_reservations.status AS reservation_status,
        invite_code_reservations.reserved_until,
        invite_code_reservations.clerk_user_id
      FROM invite_codes
      JOIN invite_code_reservations
        ON invite_code_reservations.invite_code_id = invite_codes.id
      WHERE invite_codes.code_hash = ${digest}
        AND invite_code_reservations.reservation_id = ${reservationId}
      FOR UPDATE OF invite_codes, invite_code_reservations
    `;

    if (!found.length) return [];

    const item = found[0];
    if (item.reservation_status === "used" && item.clerk_user_id === clerkUserId) return [{ id: item.id }];

    const now = Date.now();
    const expiresAt = item.expires_at ? new Date(String(item.expires_at)).getTime() : null;
    const reservedUntil = item.reserved_until ? new Date(String(item.reserved_until)).getTime() : 0;
    const invitedEmail = item.invited_email == null ? null : String(item.invited_email).toLowerCase();
    const usageCount = Number(item.usage_count ?? 0);
    const maxUses = Number(item.max_uses ?? 1);

    if (item.invite_status === "used" || item.invite_status === "revoked" || !item.active) return [];
    if (expiresAt != null && expiresAt < now) return [];
    if (item.reservation_status !== "reserved" || reservedUntil <= now) return [];
    if (invitedEmail && invitedEmail !== normalizedEmail) return [];
    if (usageCount >= maxUses) return [];

    const nextUsageCount = usageCount + 1;
    const nextStatus = nextUsageCount >= maxUses ? "used" : "active";

    await tx`
      UPDATE invite_code_reservations
      SET status = 'used',
          clerk_user_id = ${clerkUserId},
          used_at = now()
      WHERE id = ${item.reservation_row_id}
    `;

    return tx`
      UPDATE invite_codes
      SET usage_count = ${nextUsageCount},
          status = ${nextStatus},
          active = ${nextUsageCount < maxUses},
          deactivated_at = CASE
            WHEN ${nextUsageCount >= maxUses} THEN COALESCE(deactivated_at, now())
            ELSE deactivated_at
          END,
          used_at = now(),
          used_by_clerk_user_id = ${clerkUserId},
          reserved_until = CASE WHEN ${nextStatus} = 'used' THEN null ELSE reserved_until END
      WHERE id = ${item.id}
      RETURNING id
    `;
  });

  if (rows.length === 1) return true;

  // Compatibility path for a reservation created before invite_code_reservations existed.
  const legacyRows = await sql`
    UPDATE invite_codes
    SET usage_count = usage_count + 1,
        status = CASE WHEN usage_count + 1 >= max_uses THEN 'used' ELSE 'active' END,
        active = usage_count + 1 < max_uses,
        deactivated_at = CASE
          WHEN usage_count + 1 >= max_uses THEN COALESCE(deactivated_at, now())
          ELSE deactivated_at
        END,
        used_at = now(),
        used_by_clerk_user_id = ${clerkUserId},
        reserved_until = null
    WHERE code_hash = ${digest}
      AND reservation_id = ${reservationId}
      AND status = 'reserved'
      AND active = true
      AND usage_count < max_uses
      AND reserved_until > now()
      AND (invited_email IS NULL OR invited_email = ${normalizedEmail})
    RETURNING id
  `;

  if (legacyRows.length === 1) return true;

  const existing = await sql`
    SELECT id
    FROM invite_codes
    WHERE code_hash = ${digest}
      AND reservation_id = ${reservationId}
      AND used_by_clerk_user_id = ${clerkUserId}
      AND reserved_until IS NULL
      AND usage_count > 0
      AND (invited_email IS NULL OR invited_email = ${normalizedEmail})
    LIMIT 1
  `;
  return existing.length === 1;
}

export async function listInviteCodes() {
  await ensureInviteCodeSchema();
  const rows = await getSql()`
    SELECT id, label, invited_email, status, active, usage_count, max_uses, created_at, expires_at, reserved_at, reserved_until, used_at, used_by_clerk_user_id, revoked_at, deactivated_at
    FROM invite_codes
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return rows.map(mapRecord);
}

export async function deactivateInviteCode(id: string): Promise<DeactivateResult> {
  const inviteId = id.trim();
  if (!inviteId) return { ok: false, reason: "missing" };
  if (!UUID_PATTERN.test(inviteId)) return { ok: false, reason: "invalid" };

  await ensureInviteCodeSchema();
  const sql = getSql();
  const rows = await sql.begin(async (tx) => {
    const updated = await tx`
      UPDATE invite_codes
      SET status = 'revoked',
          active = false,
          deactivated_at = COALESCE(deactivated_at, now()),
          revoked_at = COALESCE(revoked_at, now()),
          reservation_id = null,
          reserved_until = null
      WHERE id = ${inviteId}
        AND status IN ('active', 'reserved')
      RETURNING id, label, invited_email, status, active, usage_count, max_uses, created_at, expires_at, reserved_at, reserved_until, used_at, used_by_clerk_user_id, revoked_at, deactivated_at
    `;

    if (updated.length) {
      await tx`
        UPDATE invite_code_reservations
        SET status = 'revoked'
        WHERE invite_code_id = ${inviteId}
          AND status = 'reserved'
      `;
    }

    return updated;
  });

  if (rows.length === 1) return { ok: true, record: mapRecord(rows[0]) };

  const existing = await sql`
    SELECT id, label, invited_email, status, active, usage_count, max_uses, created_at, expires_at, reserved_at, reserved_until, used_at, used_by_clerk_user_id, revoked_at, deactivated_at
    FROM invite_codes
    WHERE id = ${inviteId}
    LIMIT 1
  `;
  if (!existing.length) return { ok: false, reason: "not_found" };

  const record = mapRecord(existing[0]);
  if (record.status === "revoked") return { ok: true, record };
  return { ok: false, reason: "used" };
}

export function isValidInviteAdminToken(value: string | null): boolean {
  const expected = process.env.INVITE_CODE_ADMIN_TOKEN;
  if (!expected || expected.trim().length < 32 || !value) return false;
  return safeEqual(value, expected);
}
