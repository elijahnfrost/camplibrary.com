import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken, generateFeedToken } from "./calendarFeeds";

// The at-rest token encryption that backs the "copy link" affordance. Pure
// crypto (no DB), so it's unit-testable by just setting the secret it derives
// its key from.
const SECRET = "test-invite-code-secret-0123456789abcdef"; // >= 32 chars, like prod.

describe("calendar feed token encryption", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.INVITE_CODE_SECRET;
    process.env.INVITE_CODE_SECRET = SECRET;
  });
  afterEach(() => {
    if (saved == null) delete process.env.INVITE_CODE_SECRET;
    else process.env.INVITE_CODE_SECRET = saved;
  });

  it("round-trips a token and never stores it in the clear", () => {
    const token = generateFeedToken();
    const blob = encryptToken(token);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain(token);
    expect(decryptToken(blob)).toBe(token);
  });

  it("uses a fresh IV per call (distinct ciphertext) yet both decrypt", () => {
    const token = generateFeedToken();
    const a = encryptToken(token);
    const b = encryptToken(token);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(token);
    expect(decryptToken(b)).toBe(token);
  });

  it("rejects tampered ciphertext via the GCM auth tag", () => {
    const blob = encryptToken(generateFeedToken());
    const payload = blob.slice(3);
    const tampered = "v1:" + (payload[0] === "A" ? "B" : "A") + payload.slice(1);
    expect(decryptToken(tampered)).toBeNull();
  });

  it("cannot decrypt a token sealed under a different secret (DB leak alone is useless)", () => {
    const blob = encryptToken(generateFeedToken());
    process.env.INVITE_CODE_SECRET = "a-totally-different-secret-0123456789xyz";
    expect(decryptToken(blob)).toBeNull();
  });

  it("returns null for legacy/garbage blobs instead of throwing", () => {
    expect(decryptToken(null)).toBeNull();
    expect(decryptToken(undefined)).toBeNull();
    expect(decryptToken("")).toBeNull();
    expect(decryptToken("not-versioned")).toBeNull();
    expect(decryptToken("v1:")).toBeNull();
    expect(decryptToken("v1:!!!notbase64!!!")).toBeNull();
  });
});
