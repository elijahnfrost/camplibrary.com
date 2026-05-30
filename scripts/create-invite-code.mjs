#!/usr/bin/env node

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

const code = argValue("--code") || generateCode();
const label = argValue("--label") || null;
const invitedEmail = argValue("--email")?.trim().toLowerCase() || null;
const expiresAt = argValue("--expires-at") || null;
const codeHash = createHmac("sha256", secret).update(normalize(code)).digest("hex");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  await sql`CREATE TABLE IF NOT EXISTS invite_codes (
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
  )`;

  const rows = await sql`
    INSERT INTO invite_codes (id, code_hash, label, invited_email, expires_at)
    VALUES (${randomUUID()}, ${codeHash}, ${label}, ${invitedEmail}, ${expiresAt ? new Date(expiresAt) : null})
    RETURNING id
  `;
  console.log(`Invite code: ${display(normalize(code))}`);
  console.log(`Invite id: ${rows[0].id}`);
} finally {
  await sql.end();
}
