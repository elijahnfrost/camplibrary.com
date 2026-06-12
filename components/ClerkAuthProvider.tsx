"use client";

import { ClerkProvider } from "@clerk/nextjs";

export function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      signInUrl="/?auth=sign-in"
      signUpUrl="/?auth=sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/auth/complete"
    >
      {children}
    </ClerkProvider>
  );
}
