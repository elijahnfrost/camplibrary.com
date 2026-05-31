import { auth, currentUser } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAdminEmail, isClerkAuthUsable } from "@/lib/auth";
import { CampApp } from "@/components/CampApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
};

export default async function AdminPage() {
  if (!isClerkAuthUsable()) notFound();

  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: "/admin" });

  const user = await currentUser();
  if (!user) return redirectToSignIn({ returnBackUrl: "/admin" });
  if (!isAdminEmail(user.primaryEmailAddress?.emailAddress)) notFound();

  return <CampApp initialTab="admin" />;
}
