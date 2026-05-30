import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { consumeInviteCode } from "@/lib/server/inviteCodes";
import { getOptionalServerEnv } from "@/lib/server/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const webhookSecret = getOptionalServerEnv("CLERK_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return Response.json({ error: "Webhook secret is not configured" }, { status: 503 });
  }

  const payload = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") || "",
    "svix-timestamp": request.headers.get("svix-timestamp") || "",
    "svix-signature": request.headers.get("svix-signature") || "",
  };

  let event: WebhookEvent;
  try {
    event = new Webhook(webhookSecret).verify(payload, headers) as WebhookEvent;
  } catch {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  if (event.type === "user.created") {
    const metadata = event.data.unsafe_metadata as Record<string, unknown>;
    const inviteCode = typeof metadata.inviteCode === "string" ? metadata.inviteCode : "";
    const reservationId = typeof metadata.inviteReservationId === "string" ? metadata.inviteReservationId : "";
    const primaryEmail = event.data.email_addresses.find(
      (email) => email.id === event.data.primary_email_address_id,
    )?.email_address;
    if (inviteCode && reservationId) {
      await consumeInviteCode({
        code: inviteCode,
        reservationId,
        clerkUserId: event.data.id,
        userEmail: primaryEmail || null,
      });
    }
  }

  return Response.json({ ok: true });
}
