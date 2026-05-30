#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const required = ["AUTH_SECRET"];

const optional = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "DATABASE_URL",
  "CAMP_LIBRARY_API_URL",
  "CAMP_LIBRARY_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_API_TOKEN",
];

const placeholderRe = /^(|<.*>|.*placeholder.*|changeme|change-me|example|replace-me|todo|your-.+)$/i;

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

function isConfigured(env, key) {
  const value = env[key];
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (placeholderRe.test(trimmed)) return false;
  if (key === "AUTH_SECRET" && trimmed.length < 32) return false;
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
