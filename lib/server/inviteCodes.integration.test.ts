import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration coverage for the invite-code state machine against a REAL Postgres.
// Skipped unless TEST_DATABASE_URL is set, so `npm test` / CI (no DB) skip it.
// Run locally with: TEST_DATABASE_URL=postgres://... npx vitest run inviteCodes.integration
const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("consumeInviteCode — one seat per distinct user (integration)", () => {
  // Imported after env is set so getSql()/codeDigest read the test DB + secret.
  let createInviteCode: typeof import("./inviteCodes").createInviteCode;
  let reserveInviteCode: typeof import("./inviteCodes").reserveInviteCode;
  let consumeInviteCode: typeof import("./inviteCodes").consumeInviteCode;
  let releaseInviteCode: typeof import("./inviteCodes").releaseInviteCode;
  let getSql: typeof import("./db").getSql;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.INVITE_CODE_SECRET = "integration-test-invite-secret-0123456789";
    const mod = await import("./inviteCodes");
    createInviteCode = mod.createInviteCode;
    reserveInviteCode = mod.reserveInviteCode;
    consumeInviteCode = mod.consumeInviteCode;
    releaseInviteCode = mod.releaseInviteCode;
    getSql = (await import("./db")).getSql;
  });

  afterAll(async () => {
    await getSql().end({ timeout: 5 });
  });

  async function reserve(code: string): Promise<string> {
    const result = await reserveInviteCode({ code });
    if (!result.ok) throw new Error(`reserve failed: ${result.reason}`);
    return result.reservationId;
  }

  async function inviteRow(id: string) {
    const rows = await getSql()`SELECT usage_count, status, active FROM invite_codes WHERE id = ${id}`;
    return rows[0] as { usage_count: number; status: string; active: boolean };
  }

  async function reservationStatuses(inviteId: string) {
    const rows = await getSql()`
      SELECT status, clerk_user_id FROM invite_code_reservations WHERE invite_code_id = ${inviteId}
    `;
    return rows as unknown as Array<{ status: string; clerk_user_id: string | null }>;
  }

  it("one user holding every reservation can consume only ONE seat", async () => {
    const { code, record } = await createInviteCode({ maxUses: 3 });

    // A single actor grabs all three reservations.
    const r1 = await reserve(code);
    const r2 = await reserve(code);
    const r3 = await reserve(code);

    // ...then tries to consume all three as the same Clerk user.
    expect(await consumeInviteCode({ code, reservationId: r1, clerkUserId: "user_a" })).toBe(true);
    expect(await consumeInviteCode({ code, reservationId: r2, clerkUserId: "user_a" })).toBe(true);
    expect(await consumeInviteCode({ code, reservationId: r3, clerkUserId: "user_a" })).toBe(true);

    // Only one seat is burned; the other reservations are revoked, not used.
    const invite = await inviteRow(record.id);
    expect(invite.usage_count).toBe(1);
    expect(invite.active).toBe(true);

    const reservations = await reservationStatuses(record.id);
    const used = reservations.filter((r) => r.status === "used");
    const revoked = reservations.filter((r) => r.status === "revoked");
    expect(used).toHaveLength(1);
    expect(used[0].clerk_user_id).toBe("user_a");
    expect(revoked).toHaveLength(2);
  });

  it("still admits N distinct users up to maxUses", async () => {
    const { code, record } = await createInviteCode({ maxUses: 3 });

    const ra = await reserve(code);
    expect(await consumeInviteCode({ code, reservationId: ra, clerkUserId: "user_a" })).toBe(true);
    const rb = await reserve(code);
    expect(await consumeInviteCode({ code, reservationId: rb, clerkUserId: "user_b" })).toBe(true);
    const rc = await reserve(code);
    expect(await consumeInviteCode({ code, reservationId: rc, clerkUserId: "user_c" })).toBe(true);

    const invite = await inviteRow(record.id);
    expect(invite.usage_count).toBe(3);
    expect(invite.status).toBe("used");
    expect(invite.active).toBe(false);

    // The invite is now exhausted — no fourth reservation.
    const fourth = await reserveInviteCode({ code });
    expect(fourth.ok).toBe(false);
  });

  it("created the one-seat-per-user backstop index", async () => {
    await createInviteCode({ maxUses: 1 }); // forces ensureInviteCodeSchema()
    const rows = await getSql()`
      SELECT indexname FROM pg_indexes WHERE indexname = 'invite_code_reservations_one_per_user_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  it("caps in-flight reservations to one per source IP, but not across IPs", async () => {
    const { code } = await createInviteCode({ maxUses: 5 });

    // Same IP twice → the second is rate-limited, not granted a second seat.
    expect((await reserveInviteCode({ code, clientIp: "203.0.113.10" })).ok).toBe(true);
    const second = await reserveInviteCode({ code, clientIp: "203.0.113.10" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("rate_limited");

    // A different IP is unaffected (distinct people, distinct sources).
    expect((await reserveInviteCode({ code, clientIp: "203.0.113.20" })).ok).toBe(true);

    // No IP available → fails open (preserves the local/test path).
    expect((await reserveInviteCode({ code })).ok).toBe(true);
  });

  it("frees the per-IP slot once the prior reservation is released", async () => {
    const { code } = await createInviteCode({ maxUses: 5 });

    const first = await reserveInviteCode({ code, clientIp: "198.51.100.5" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((await reserveInviteCode({ code, clientIp: "198.51.100.5" })).ok).toBe(false);

    // Releasing (as the client does on retry/abandon) lets the same IP reserve again.
    await releaseInviteCode({ code, reservationId: first.reservationId });
    expect((await reserveInviteCode({ code, clientIp: "198.51.100.5" })).ok).toBe(true);
  });
});
