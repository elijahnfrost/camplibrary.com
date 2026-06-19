import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

// Mirrors the invite-codes route gating tests: exercise the auth + backend
// gates without a live database. The localhost host header trips the staff
// bypass in requireEditorSession, so we reach the backend-availability check.
const KEYS = ["DATABASE_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"] as const;
const saved: Record<string, string | undefined> = {};

function localRequest(method = "GET") {
  return new Request("http://localhost/api/calendar/feeds", {
    method,
    headers: { host: "localhost", "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify({ campId: null }) : undefined,
  }) as NextRequest;
}

describe("calendar feeds route gating", () => {
  beforeEach(() => {
    for (const key of KEYS) saved[key] = process.env[key];
  });
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] == null) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("GET returns 503 when the database is unconfigured (auth via localhost)", async () => {
    delete process.env.DATABASE_URL;
    const response = await GET(localRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, reason: "backend_unavailable" });
  });

  it("POST returns 503 when the database is unconfigured", async () => {
    delete process.env.DATABASE_URL;
    const response = await POST(localRequest("POST"));
    expect(response.status).toBe(503);
  });

  it("rejects an unauthenticated, non-local caller with 401 before touching the backend", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
    const response = await GET(
      new Request("https://example.test/api/calendar/feeds") as NextRequest,
    );
    expect(response.status).toBe(401);
  });
});
