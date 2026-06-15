#!/usr/bin/env node

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const maxPostgresInteger = 2147483647;
const maxInviteEmailLength = 320;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseDotenv(filePath) {
  if (!existsSync(filePath)) return {};
  const env = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function normalize(code) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function display(code) {
  return code.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

function generateCode() {
  const bytes = randomBytes(12);
  let code = "";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return display(code);
}

function parseMaxUses(value) {
  const maxUses = value == null || value === "" ? 1 : Number(value);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > maxPostgresInteger) {
    console.error("--max-uses must be a positive integer.");
    process.exit(1);
  }
  return maxUses;
}

function parseInvitedEmail(value) {
  if (value == null || value === "") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > maxInviteEmailLength || !emailPattern.test(email)) {
    console.error("--email must be a valid email address.");
    process.exit(1);
  }
  return email;
}

const code = argValue("--code") || generateCode();
const label = argValue("--label") || null;
if (hasArg("--email") && argValue("--email") == null) {
  console.error("--email requires a value.");
  process.exit(1);
}
const invitedEmail = parseInvitedEmail(argValue("--email"));
const expiresAt = argValue("--expires-at") || null;
const maxUses = parseMaxUses(argValue("--max-uses"));

const env = {
  ...parseDotenv(resolve(".env")),
  ...parseDotenv(resolve(".env.local")),
  ...process.env,
};

const databaseUrl = env.DATABASE_URL;
const secret = env.INVITE_CODE_SECRET;

if (!databaseUrl || !secret || secret.length < 32) {
  console.error("DATABASE_URL and INVITE_CODE_SECRET (32+ chars) are required.");
  process.exit(1);
}

const codeHash = createHmac("sha256", secret).update(normalize(code)).digest("hex");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
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
  // One 'used' reservation per (invite, clerk_user_id) — see lib/server/inviteCodes.ts.
  // Guarded so it is migration-safe on data that already violated it.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM (
          SELECT 1
          FROM invite_code_reservations
          WHERE status = 'used' AND clerk_user_id IS NOT NULL
          GROUP BY invite_code_id, clerk_user_id
          HAVING count(*) > 1
        ) AS duplicates
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS invite_code_reservations_one_per_user_idx
          ON invite_code_reservations (invite_code_id, clerk_user_id)
          WHERE status = 'used' AND clerk_user_id IS NOT NULL;
      END IF;
    END $$;
  `;

  const rows = await sql`
    INSERT INTO invite_codes (id, code_hash, label, invited_email, expires_at, max_uses)
    VALUES (${randomUUID()}, ${codeHash}, ${label}, ${invitedEmail}, ${expiresAt ? new Date(expiresAt) : null}, ${maxUses})
    RETURNING id
  `;
  console.log(`Invite code: ${display(normalize(code))}`);
  console.log(`Invite id: ${rows[0].id}`);
  console.log(`Max uses: ${maxUses}`);
} finally {
  await sql.end();
}
