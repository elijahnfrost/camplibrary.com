import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalInviteCodeSecret = process.env.INVITE_CODE_SECRET;

function restoreEnv() {
  if (originalDatabaseUrl == null) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  if (originalInviteCodeSecret == null) {
    delete process.env.INVITE_CODE_SECRET;
  } else {
    process.env.INVITE_CODE_SECRET = originalInviteCodeSecret;
  }
}

describe("invite code reservation route", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("returns a friendly 503 when invite backend env is missing", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.INVITE_CODE_SECRET;

    const response = await POST(
      new Request("https://example.test/api/invite-codes/reserve", {
        method: "POST",
        body: JSON.stringify({ code: "TEST-CODE", email: "staff@example.com" }),
      }) as NextRequest,
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: "backend_unavailable",
      message: expect.stringContaining("temporarily unavailable"),
    });
    expect(response.status).toBe(503);
  });
});
