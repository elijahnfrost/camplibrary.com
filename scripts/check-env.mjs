#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const required = [
  "AUTH_SECRET",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
  "INVITE_CODE_SECRET",
];

const optional = [
  "NEXT_PUBLIC_APP_URL",
  "CLERK_WEBHOOK_SECRET",
  "INVITE_CODE_ADMIN_TOKEN",
  "CAMP_LIBRARY_API_URL",
  "CAMP_LIBRARY_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_API_TOKEN",
];

const placeholderRe = /^(|<.*>|.*placeholder.*|changeme|change-me|example|replace-me|todo|your-.+)$/i;
const dummyClerkMarkers = [
  "pk_test_zm9vlwjhci0xmjmu",
  "sk_test_dgvzdhnly3jldgtlewzvcmxvy2fszgv2",
  "foo-bar-123.clerk.accounts.dev",
  "testsecretkeyforlocaldevonly",
  "localdevonly",
  "local-dev",
];

function parseDotenv(filePath) {
  if (!existsSync(filePath)) return {};

  const env = {};
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function loadLocalEnv() {
  return {
    ...parseDotenv(resolve(".env")),
    ...parseDotenv(resolve(".env.local")),
    ...process.env,
  };
}

function decodeClerkPayload(value) {
  const encoded = value.replace(/^pk_(?:test|live)_/, "").replace(/^sk_(?:test|live)_/, "").replace(/\$$/, "");
  if (!encoded || encoded === value) return value;

  try {
    return Buffer.from(encoded, "base64").toString() || value;
  } catch {
    return value;
  }
}

function isUsableClerkKey(value) {
  const trimmed = value.trim();
  if (placeholderRe.test(trimmed)) return false;
  const raw = trimmed.toLowerCase();
  if (dummyClerkMarkers.some((marker) => raw.includes(marker))) return false;
  const decoded = decodeClerkPayload(trimmed).toLowerCase();
  return !dummyClerkMarkers.some((marker) => decoded.includes(marker));
}

function isClerkPublicKeyUsable(value) {
  const trimmed = value.trim();
  return trimmed.startsWith("pk_") && isUsableClerkKey(trimmed);
}

function isClerkSecretKeyUsable(value) {
  const trimmed = value.trim();
  return trimmed.startsWith("sk_") && isUsableClerkKey(trimmed);
}

function isConfigured(env, key) {
  const value = env[key];
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (placeholderRe.test(trimmed)) return false;
  if (key === "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") return isClerkPublicKeyUsable(trimmed);
  if (key === "CLERK_SECRET_KEY") return isClerkSecretKeyUsable(trimmed);
  if (key === "AUTH_SECRET" && trimmed.length < 32) return false;
  if (key === "INVITE_CODE_SECRET" && trimmed.length < 32) return false;
  if (key === "INVITE_CODE_ADMIN_TOKEN" && trimmed.length < 32) return false;
  return true;
}

function formatKeys(keys) {
  return keys.length ? keys.join(", ") : "none";
}

const env = loadLocalEnv();
const missingRequired = required.filter((key) => !isConfigured(env, key));
const presentOptional = optional.filter((key) => isConfigured(env, key));
const missingOptional = optional.filter((key) => !isConfigured(env, key));

const unsafePublic = Object.keys(env).filter(
  (key) =>
    key.startsWith("NEXT_PUBLIC_") &&
    /(SECRET|TOKEN|PASSWORD|PRIVATE|DATABASE_URL)/i.test(key) &&
    key !== "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
);

console.log("Backend env check");
console.log(`Required missing: ${formatKeys(missingRequired)}`);
console.log(`Optional present: ${formatKeys(presentOptional)}`);
console.log(`Optional missing: ${formatKeys(missingOptional)}`);

if (unsafePublic.length > 0) {
  console.error(`Unsafe public env names: ${formatKeys(unsafePublic)}`);
}

if (missingRequired.length > 0 || unsafePublic.length > 0) {
  process.exit(1);
}
