import { currentUser } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/auth";
import { AdminInviteCodes } from "@/components/AdminInviteCodes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
};

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!isAdminEmail(user.primaryEmailAddress?.emailAddress)) notFound();

  return (
    <main className="admin-page">
      <div className="admin-page__head">
        <a className="auth-pill" href="/">
          Camp Library
        </a>
        <div>
          <span className="auth-route__kicker">Administrator</span>
          <h1 className="auth-route__title">Staff access</h1>
        </div>
      </div>
      <AdminInviteCodes />
    </main>
  );
}
