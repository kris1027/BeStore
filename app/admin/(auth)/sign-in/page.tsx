import type { Metadata } from "next";

import { AuthCard } from "@/features/admin-auth/components/auth-frame";
import { SignInForm } from "@/features/admin-auth/components/sign-in-form";
import { signInReason } from "@/features/admin-auth/messages";
import { redirectIfSignedIn } from "@/features/admin-auth/require-admin";

// Reads the session or search params at the top level; allowed to block until converted
// to Suspense (spec 0005, Caching model).
export const instant = false;

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/admin/sign-in">) {
  const { next, reason } = await searchParams;
  const nextPath = typeof next === "string" ? next : null;
  await redirectIfSignedIn(nextPath);

  return (
    <AuthCard
      title="Sign in"
      description="Use your admin email and password. You will need your authenticator app next."
    >
      <SignInForm next={nextPath} reason={signInReason(reason)} />
    </AuthCard>
  );
}
