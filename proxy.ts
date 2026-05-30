import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

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
