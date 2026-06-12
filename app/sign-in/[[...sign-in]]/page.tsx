import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Staff access",
};

export default function SignInPage() {
  redirect("/?auth=sign-in");
}
