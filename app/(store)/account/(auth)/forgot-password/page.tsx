import type { Metadata } from "next";
import Link from "next/link";

import { AccountAuthCard, footerLinkClass } from "@/features/account/components/auth-card";
import { ForgotPasswordForm } from "@/features/account/components/forgot-password-form";
import { accountPaths } from "@/features/account/paths";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AccountAuthCard
      title="Reset your password"
      description="Enter your account email. We send a link that works once, within an hour."
      footer={
        <Link href={accountPaths.signIn} className={footerLinkClass}>
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AccountAuthCard>
  );
}
