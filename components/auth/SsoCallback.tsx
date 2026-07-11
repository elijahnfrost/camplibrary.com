"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
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

export function SsoCallback() {
  const clerk = useClerk();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Finalizing sign in...");

  useEffect(() => {
    let active = true;
    const inviteCode = searchParams.get("inviteCode") || "";
    const reservationId = searchParams.get("inviteReservationId") || "";

    async function finishRedirect() {
      try {
        await clerk.handleRedirectCallback({
          signInUrl: "/?auth=sign-in",
          signUpUrl: "/?auth=sign-up",
          signUpFallbackRedirectUrl: "/auth/complete",
        });
      } catch {
        if (inviteCode && reservationId) {
          await releaseInviteCode(inviteCode, reservationId);
          window.sessionStorage.removeItem(PENDING_GOOGLE_INVITE_RESERVATION_KEY);
        }
        if (!active) return;
        setMessage(
          inviteCode && reservationId
            ? "Google sign-up was canceled. Your invite code is available to try again."
            : "Could not finish Google sign-in.",
        );
        router.replace(inviteCode && reservationId ? "/?auth=sign-up" : "/?auth=sign-in");
      }
    }

    void finishRedirect();
    return () => {
      active = false;
    };
  }, [clerk, router, searchParams]);

  return <div className="auth-route__status">{message}</div>;
}
