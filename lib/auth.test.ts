import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_SESSION,
  staffActionGate,
  isClerkPublicKeyUsable,
  isClerkSecretKeyUsable,
  type AuthSession,
} from "./auth";

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

describe("staff action gate", () => {
  const staffSession: AuthSession = {
    status: "authenticated",
    user: {
      id: "user_1",
      name: "Ada",
      email: "ada@example.com",
      role: "editor",
    },
    mode: "provider",
    authenticatedAt: "2026-06-12T00:00:00.000Z",
  };

  it("allows authenticated staff actions", () => {
    expect(staffActionGate(staffSession, "edit run lists", { authEnabled: true, returnTo: "/?activity=ctf" })).toEqual({
      allowed: true,
    });
  });

  it("blocks anonymous staff actions with a safe sign-in target when auth is available", () => {
    expect(
      staffActionGate(ANONYMOUS_SESSION, "edit run lists", {
        authEnabled: true,
        returnTo: "/?activity=ctf",
        origin: "https://camp.example",
      })
    ).toEqual({
      allowed: false,
      message: "Sign in as staff to edit run lists.",
      signInHref: "https://camp.example/sign-in?next=%2F%3Factivity%3Dctf&redirect_url=https%3A%2F%2Fcamp.example%2F%3Factivity%3Dctf",
    });
  });

  it("blocks anonymous staff actions without sending users to dead auth pages when auth is unavailable", () => {
    expect(
      staffActionGate(ANONYMOUS_SESSION, "add activities", {
        authEnabled: false,
        returnTo: "/library",
        origin: "https://camp.example",
      })
    ).toEqual({
      allowed: false,
      message: "Staff sign-in is not configured, so add activities is unavailable.",
      signInHref: null,
    });
  });

  it("normalizes unsafe return paths to the app root", () => {
    expect(
      staffActionGate(ANONYMOUS_SESSION, "plan the calendar", {
        authEnabled: true,
        returnTo: "https://evil.example/",
        origin: "https://camp.example",
      })
    ).toEqual({
      allowed: false,
      message: "Sign in as staff to plan the calendar.",
      signInHref: "https://camp.example/sign-in?next=%2F&redirect_url=https%3A%2F%2Fcamp.example%2F",
    });
  });
});
