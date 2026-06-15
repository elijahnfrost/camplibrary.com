import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// Regression net for the finding where /api/health called requireAdminSession ->
// auth() but was absent from the clerkMiddleware matcher, so Clerk threw
// "auth() was called but Clerk can't detect usage of clerkMiddleware()" and the
// route 500'd in production. Any API route that can reach auth()/currentUser()
// MUST be covered by proxy.ts's matcher, or it breaks the same way.

const ROOT = resolve(__dirname);
const API_DIR = resolve(ROOT, "app/api");

// Convert a Next.js matcher entry to a RegExp. "(.*)" is the only wildcard the
// matcher uses here; everything else is a literal path segment.
function matcherToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("(.*)")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + "$");
}

const MATCHERS = (config.matcher as string[]).map(matcherToRegExp);

function isCovered(pathname: string): boolean {
  return MATCHERS.some((re) => re.test(pathname));
}

// Map an app-router route file to the URL pathname it serves, substituting a
// concrete value for dynamic ([id]) and catch-all ([[...x]]) segments.
function routePathFor(routeFile: string): string {
  const rel = routeFile.slice(resolve(ROOT, "app").length).replace(/\/route\.ts$/, "");
  return rel
    .split("/")
    .map((seg) => (seg.startsWith("[") ? "x" : seg))
    .join("/");
}

const AUTH_CALL_RE = /\b(requireEditorSession|requireAdminSession|getServerAuthSession|currentUser|auth)\s*\(/;

function apiRouteFiles(): string[] {
  return readdirSync(API_DIR, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith("route.ts") && !entry.endsWith(".test.ts"))
    .map((entry) => resolve(API_DIR, entry));
}

describe("proxy.ts clerkMiddleware matcher", () => {
  it("covers /api/health (the route that regressed)", () => {
    expect(isCovered("/api/health")).toBe(true);
  });

  it("covers every API route that can call auth()/currentUser()", () => {
    const uncovered: string[] = [];
    for (const file of apiRouteFiles()) {
      const source = readFileSync(file, "utf8");
      if (!AUTH_CALL_RE.test(source)) continue;
      const pathname = routePathFor(file);
      if (!isCovered(pathname)) uncovered.push(pathname);
    }
    expect(uncovered).toEqual([]);
  });
});
