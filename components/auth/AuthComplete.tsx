"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const PENDING_GOOGLE_INVITE_RESERVATION_KEY = "camp-library:pending-google-invite-reservation";

async function releaseInviteCode(inviteCode: string, reservationId: string) {
  await fetch("/api/invite-codes/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: inviteCode, reservationId }),
    keepalive: true,
  }).catch(() => undefined);
}

export function AuthComplete() {
  const clerk = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();
  const [message, setMessage] = useState("Finalizing account...");

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !user) {
      router.replace("/?auth=sign-in");
      return;
    }

    const metadata = user.unsafeMetadata as Record<string, unknown>;
    const inviteCode = typeof metadata.inviteCode === "string" ? metadata.inviteCode : "";
    const reservationId = typeof metadata.inviteReservationId === "string" ? metadata.inviteReservationId : "";

    if (!inviteCode || !reservationId) {
      router.replace("/");
      return;
    }

    let cancelled = false;

    async function completeAccount() {
      // The invite is consumed server-side before the account is marked accepted;
      // a transient failure of that second step returns a retriable 503 (code
      // INVITE_ACCEPT_RETRY). Because consume is idempotent, retrying the same
      // request re-reaches the mark and finishes onboarding instead of stranding
      // the user with a burned seat. Any other failure is terminal as before.
      const MAX_ATTEMPTS = 4;
      try {
        for (let attempt = 1; ; attempt += 1) {
          const response = await fetch("/api/invite-codes/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: inviteCode, reservationId }),
          });
          if (response.ok) {
            window.sessionStorage.removeItem(PENDING_GOOGLE_INVITE_RESERVATION_KEY);
            if (!cancelled) router.replace("/");
            return;
          }
          const body = (await response.json().catch(() => null)) as { code?: string } | null;
          const retriable = response.status === 503 && body?.code === "INVITE_ACCEPT_RETRY";
          if (!retriable || attempt >= MAX_ATTEMPTS || cancelled) {
            throw new Error("Could not finalize invite code.");
          }
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          if (cancelled) return;
        }
      } catch (error) {
        await releaseInviteCode(inviteCode, reservationId);
        window.sessionStorage.removeItem(PENDING_GOOGLE_INVITE_RESERVATION_KEY);
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Could not finalize account.");
          await clerk.signOut({ redirectUrl: "/?auth=sign-up" });
        }
      }
    }

    void completeAccount();

    return () => {
      cancelled = true;
    };
  }, [clerk, isLoaded, isSignedIn, router, user]);

  return <div className="auth-route__status">{message}</div>;
}
