import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/features/admin-auth/components/auth-frame";
import { ForgotPasswordForm } from "@/features/admin-auth/components/forgot-password-form";
import { redirectIfSignedIn } from "@/features/admin-auth/require-admin";

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
