import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AccountAuthCard,
  AuthFormSkeleton,
  footerLinkClass,
} from "@/features/account/components/auth-card";
import { SignedOutOnly } from "@/features/account/components/signed-out-only";
import { SignUpForm } from "@/features/account/components/sign-up-form";
import { accountPaths } from "@/features/account/paths";

export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return (
    <AccountAuthCard
      title="Create an account"
      description="Enter your email. We send you a link to confirm it, then you choose a password. You can always check out as a guest instead."
      footer={
        <>
          <span className="text-muted-foreground">Already have an account?</span>
          <Link href={accountPaths.signIn} className={footerLinkClass}>
            Sign in
          </Link>
        </>
      }
    >
      <Suspense fallback={<AuthFormSkeleton />}>
        <SignedOutOnly>
          <SignUpForm />
        </SignedOutOnly>
      </Suspense>
    </AccountAuthCard>
  );
}
