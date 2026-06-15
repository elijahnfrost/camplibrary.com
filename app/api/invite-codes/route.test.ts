import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

// 40 chars, satisfies the >=32 admin-token length requirement.
const ADMIN_TOKEN = "invite-admin-token-for-tests-0123456789ab";
const KEYS = [
  "DATABASE_URL",
  "INVITE_CODE_SECRET",
  "INVITE_CODE_ADMIN_TOKEN",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
] as const;

const saved: Record<string, string | undefined> = {};

describe("invite-codes admin route backend gating", () => {
  beforeEach(() => {
    for (const key of KEYS) saved[key] = process.env[key];
  });
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] == null) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("GET returns 503 (not an unhandled 500) when the database is unconfigured", async () => {
    process.env.INVITE_CODE_ADMIN_TOKEN = ADMIN_TOKEN;
    delete process.env.DATABASE_URL;

    const response = await GET(
      new Request("https://example.test/api/invite-codes", {
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      }) as NextRequest,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, reason: "backend_unavailable" });
  });

  it("POST returns 503 when the invite-code backend is unconfigured", async () => {
    process.env.INVITE_CODE_ADMIN_TOKEN = ADMIN_TOKEN;
    delete process.env.DATABASE_URL;
    delete process.env.INVITE_CODE_SECRET;

    const response = await POST(
      new Request("https://example.test/api/invite-codes", {
        method: "POST",
        headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ maxUses: 1 }),
      }) as NextRequest,
    );

    expect(response.status).toBe(503);
  });

  it("still rejects an unauthorized caller before touching the backend", async () => {
    process.env.INVITE_CODE_ADMIN_TOKEN = ADMIN_TOKEN;
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    const response = await GET(new Request("https://example.test/api/invite-codes") as NextRequest);

    expect(response.status).toBe(401);
  });
});
