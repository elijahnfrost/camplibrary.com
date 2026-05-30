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
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/__clerk/(.*)",
    "/(api|trpc)(.*)",
  ],
};
