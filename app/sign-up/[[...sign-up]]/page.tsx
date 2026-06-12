import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Create account",
};

export default function SignUpPage() {
  redirect("/?auth=sign-up");
}
