"use client";

import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AuthComplete() {
  const { isLoaded, isSignedIn, user } = useUser();
  const router = useRouter();
  const [message, setMessage] = useState("Finalizing account...");

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !user) {
      router.replace("/sign-in");
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
    fetch("/api/invite-codes/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: inviteCode, reservationId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error("Could not finalize invite code.");
        if (!cancelled) router.replace("/");
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not finalize account.");
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, router, user]);

  return <div className="auth-route__status">{message}</div>;
}
