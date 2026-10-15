import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AccountAuthCard,
  AuthFormSkeleton,
  footerLinkClass,
} from "@/features/account/components/auth-card";
import { SignInForm } from "@/features/account/components/sign-in-form";
import { SignedOutOnly } from "@/features/account/components/signed-out-only";
import { accountPaths } from "@/features/account/paths";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function SignInPage({ searchParams }: PageProps<"/account/sign-in">) {
  return (
    <AccountAuthCard
      title="Sign in"
      description="See your orders and saved addresses, and check out faster."
      footer={
        <>
          <span className="text-muted-foreground">New here?</span>
          <Link href={accountPaths.signUp} className={footerLinkClass}>
            Create an account
          </Link>
        </>
      }
    >
      <Suspense fallback={<AuthFormSkeleton />}>
        <SignedOutOnly>
          <SignInWithNext searchParams={searchParams} />
        </SignedOutOnly>
      </Suspense>
    </AccountAuthCard>
  );
}

// `next` is passed on as typed; the action accepts it only when it is safe (AC-4).
async function SignInWithNext({
  searchParams,
}: {
  readonly searchParams: PageProps<"/account/sign-in">["searchParams"];
}) {
  const { next } = await searchParams;
  return <SignInForm next={typeof next === "string" ? next : null} />;
}
