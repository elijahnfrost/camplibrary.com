import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isClerkAuthUsable } from "@/lib/auth";

const handleClerkMiddleware = clerkMiddleware();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isClerkAuthUsable()) return NextResponse.next();
  return handleClerkMiddleware(request, event);
}

export const config = {
  matcher: [
    "/admin",
    "/admin/(.*)",
    "/sign-in",
    "/sign-in/(.*)",
    "/sign-up",
    "/sign-up/(.*)",
    "/sso-callback",
    "/sso-callback/(.*)",
    "/auth/complete",
    "/api/auth",
    "/api/auth/(.*)",
    "/api/invite-codes",
    "/api/invite-codes/(.*)",
    "/api/webhooks/clerk",
  ],
};
