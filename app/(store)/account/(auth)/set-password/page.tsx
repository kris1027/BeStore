import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthFormSkeleton } from "@/features/account/components/auth-card";
import { SetPassword } from "@/features/account/components/set-password";

export const metadata: Metadata = {
  title: "Choose your password",
  robots: { index: false, follow: false },
};

export default function SetPasswordPage({ searchParams }: PageProps<"/account/set-password">) {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <SetPassword searchParams={searchParams} />
    </Suspense>
  );
}
