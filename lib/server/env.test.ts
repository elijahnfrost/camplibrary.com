import { afterEach, describe, expect, it } from "vitest";
import { getBackendEnvStatus } from "./env";

const originalPublicKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const originalSecretKey = process.env.CLERK_SECRET_KEY;

function encodedClerkKey(prefix: "pk_test" | "sk_test", payload: string) {
  return `${prefix}_${Buffer.from(payload).toString("base64")}$`;
}

function restoreEnv() {
  if (originalPublicKey == null) {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  } else {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPublicKey;
  }

  if (originalSecretKey == null) {
    delete process.env.CLERK_SECRET_KEY;
  } else {
    process.env.CLERK_SECRET_KEY = originalSecretKey;
  }
}

describe("backend env status", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("does not enable Clerk auth with only a public key", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = encodedClerkKey("pk_test", "real-clerk.example");
    delete process.env.CLERK_SECRET_KEY;

    expect(getBackendEnvStatus().capabilities.clerkAuth).toBe(false);
  });

  it("enables Clerk auth only when both public and secret keys are usable", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = encodedClerkKey("pk_test", "real-clerk.example");
    process.env.CLERK_SECRET_KEY = encodedClerkKey("sk_test", "real-secret-value");

    expect(getBackendEnvStatus().capabilities.clerkAuth).toBe(true);
  });
});
