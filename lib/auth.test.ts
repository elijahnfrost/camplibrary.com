import { describe, expect, it } from "vitest";
import { isClerkPublicKeyUsable, isClerkSecretKeyUsable } from "./auth";

function encodedClerkKey(prefix: "pk_test" | "sk_test", payload: string) {
  return `${prefix}_${Buffer.from(payload).toString("base64")}$`;
}

describe("Clerk key usability checks", () => {
  it("requires Clerk key prefixes", () => {
    expect(isClerkPublicKeyUsable("sk_test_real")).toBe(false);
    expect(isClerkSecretKeyUsable("pk_test_real")).toBe(false);
  });

  it("rejects placeholder and local development Clerk keys", () => {
    expect(isClerkPublicKeyUsable("replace-me")).toBe(false);
    expect(isClerkSecretKeyUsable("sk_test_dGVzdFNlY3JldEtleUZvckxvY2FsRGV2T25seQ==")).toBe(false);
  });

  it("accepts correctly prefixed non-placeholder Clerk keys", () => {
    expect(isClerkPublicKeyUsable(encodedClerkKey("pk_test", "real-clerk.example"))).toBe(true);
    expect(isClerkSecretKeyUsable(encodedClerkKey("sk_test", "real-secret-value"))).toBe(true);
  });
});
