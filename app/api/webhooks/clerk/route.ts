import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { markUserInviteAccepted } from "@/lib/server/auth";
import { consumeInviteCode } from "@/lib/server/inviteCodes";
import { getOptionalServerEnv } from "@/lib/server/env";
import { readTextBodyWithLimit } from "@/lib/server/requestBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const MAX_WEBHOOK_HEADER_LENGTH = 4096;

function hasInvalidWebhookHeader(value: string | null) {
  return !value || value.length > MAX_WEBHOOK_HEADER_LENGTH;
}

export async function POST(request: Request) {
  const webhookSecret = getOptionalServerEnv("CLERK_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return Response.json({ error: "Webhook secret is not configured" }, { status: 503 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (
    hasInvalidWebhookHeader(svixId) ||
    hasInvalidWebhookHeader(svixTimestamp) ||
    hasInvalidWebhookHeader(svixSignature)
  ) {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const headers = {
    "svix-id": svixId || "",
    "svix-timestamp": svixTimestamp || "",
    "svix-signature": svixSignature || "",
  };

  let event: WebhookEvent;
  try {
    const payload = await readTextBodyWithLimit(request, MAX_WEBHOOK_BODY_BYTES);
    if (payload == null) {
      return Response.json({ error: "Request body too large" }, { status: 413 });
    }
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
      const consumed = await consumeInviteCode({
        code: inviteCode,
        reservationId,
        clerkUserId: event.data.id,
        userEmail: primaryEmail || null,
      });
      if (consumed) {
        await markUserInviteAccepted(event.data.id, event.data.private_metadata as Record<string, unknown> | undefined);
      }
    }
  }

  return Response.json({ ok: true });
}
