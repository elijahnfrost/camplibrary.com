import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

// The public feed is unauthenticated (token-gated), so the only gate testable
// without a live database is the unconfigured-backend 503.
const saved: Record<string, string | undefined> = {};

describe("public ics feed route gating", () => {
  beforeEach(() => {
    saved.DATABASE_URL = process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (saved.DATABASE_URL == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.DATABASE_URL;
  });

  it("returns 503 when the database is unconfigured", async () => {
    delete process.env.DATABASE_URL;
    const response = await GET(
      new Request("https://camplibrary.com/api/ics/whatever.ics") as NextRequest,
      { params: Promise.resolve({ token: "whatever.ics" }) },
    );
    expect(response.status).toBe(503);
  });
});
