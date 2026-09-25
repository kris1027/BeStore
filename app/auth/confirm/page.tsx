import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard, AuthFrame } from "@/features/admin-auth/components/auth-frame";
import { ConfirmResetLinkForm } from "@/features/admin-auth/components/confirm-reset-link-form";
import { signInPath } from "@/features/admin-auth/safe-admin-path";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

// Opening the link verifies nothing: mail scanners open links before people do, and a GET
// that verified would spend the one time token. Only Continue (a POST) spends it (AC-9).
export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const { token_hash: tokenHash, type } = await searchParams;
  if (type !== "recovery" || typeof tokenHash !== "string" || tokenHash === "") {
    redirect(signInPath({ reason: "invalid_link" }));
  }

  return (
    <AuthFrame>
      <AuthCard
        title="Reset your password"
        description="Continue to confirm it is you. You will need your authenticator app, then you choose a new password."
      >
        <ConfirmResetLinkForm tokenHash={tokenHash} />
      </AuthCard>
    </AuthFrame>
  );
}
