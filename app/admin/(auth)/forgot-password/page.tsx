import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/features/admin-auth/components/auth-frame";
import { ForgotPasswordForm } from "@/features/admin-auth/components/forgot-password-form";
import { redirectIfSignedIn } from "@/features/admin-auth/require-admin";

// Reads the session or search params at the top level; allowed to block until converted
// to Suspense (spec 0005, Caching model).
export const instant = false;

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage() {
  await redirectIfSignedIn(null);

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your admin email. We send a link that works once, within an hour."
      footer={
        <Link
          href="/admin/sign-in"
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
