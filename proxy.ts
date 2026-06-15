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
    // Every API route runs clerkMiddleware so any handler may call auth()/
    // currentUser() without throwing "auth() was called but Clerk can't detect
    // usage of clerkMiddleware()". Enumerating individual paths let /api/health
    // (which elevates via requireAdminSession → auth()) fall outside the matcher
    // and 500 in production; one /api/(.*) entry covers it and any future route.
    "/api/(.*)",
  ],
};
