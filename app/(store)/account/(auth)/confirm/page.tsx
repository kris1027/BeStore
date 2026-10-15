import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthFormSkeleton } from "@/features/account/components/auth-card";
import { ConfirmLink } from "@/features/account/components/confirm-link";

// The link carries a one time token: never indexed, never sent onward in a Referer (the header
// itself is set in next.config.ts).
export const metadata: Metadata = {
  title: "Confirm your link",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ConfirmPage({ searchParams }: PageProps<"/account/confirm">) {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <ConfirmLink searchParams={searchParams} />
    </Suspense>
  );
}
