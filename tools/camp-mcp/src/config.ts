// Headless runtime config for the Camp Library MCP server + CLI.
//
// The tool writes to the SAME Postgres the app uses, through the app's own
// server-side functions (lib/server/userData.ts). It needs two things in the
// environment:
//   DATABASE_URL              — the production Neon connection string (server secret)
//   CAMP_ADMIN_CLERK_USER_ID  — the Clerk user id whose data we read/write (the owner)
//
// Both can come from the real process environment (how an MCP client passes
// secrets) or from a .env.local / .env at the repo root (how create-invite-code.mjs
// already loads DATABASE_URL for direct prod writes). Real env always wins.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// tools/camp-mcp/src -> repo root
export const REPO_ROOT = resolve(HERE, "../../..");

function parseDotenv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const env: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return env;
}

let loaded = false;

// Fill any missing env vars from the repo-root dotenv files. Real process.env
// values are never overwritten, so an MCP client config can supply prod secrets
// without a file on disk.
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const fromFiles = {
    ...parseDotenv(resolve(REPO_ROOT, ".env")),
    ...parseDotenv(resolve(REPO_ROOT, ".env.local")),
  };
  for (const [key, value] of Object.entries(fromFiles)) {
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

export function getDatabaseUrl(): string {
  loadEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the production Neon connection string " +
        "(set it in the MCP client config env, or in .env.local at the repo root). " +
        "Writes are impossible without it.",
    );
  }
  return url;
}

export function getAdminUserId(): string {
  loadEnv();
  const id = process.env.CAMP_ADMIN_CLERK_USER_ID?.trim();
  if (!id) {
    throw new Error(
      "CAMP_ADMIN_CLERK_USER_ID is not set. This is the Clerk user id (e.g. " +
        '"user_2ab…") whose schedule the tool reads and writes. Run `camp whoami` ' +
        "to list the user ids that already own data in the database, then set it.",
    );
  }
  return id;
}
