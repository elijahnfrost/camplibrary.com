import { auth, currentUser } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAdminEmail, isClerkAuthUsable } from "@/lib/auth";
import { AuthUnavailable } from "@/components/AuthUnavailable";
import { CampApp } from "@/components/CampApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
};

export default async function AdminPage() {
  if (!isClerkAuthUsable()) {
    return (
      <AuthUnavailable
        title="Staff access"
        message="The admin workspace is unavailable because staff sign-in is not configured."
      />
    );
  }

  const { userId } = await auth();
  if (!userId) redirect("/?auth=sign-in&next=/admin");

  const user = await currentUser();
  if (!user) redirect("/?auth=sign-in&next=/admin");
  if (!isAdminEmail(user.primaryEmailAddress?.emailAddress)) notFound();

  return <CampApp initialTab="admin" />;
}
