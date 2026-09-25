import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FormNotice } from "@/features/admin-auth/components/form-notice";
import { AuthCard } from "@/features/admin-auth/components/auth-frame";
import { SignOutButton } from "@/features/admin-auth/components/sign-out-button";
import { TotpCodeForm } from "@/features/admin-auth/components/totp-code-form";
import { TotpSetup } from "@/features/admin-auth/components/totp-setup";
import { authMessages } from "@/features/admin-auth/messages";
import { mfaViewFor } from "@/features/admin-auth/mfa-view";
import { requireAdminSession } from "@/features/admin-auth/require-admin";
import { safeAdminPath } from "@/features/admin-auth/safe-admin-path";

export const metadata: Metadata = { title: "Authenticator code" };

export default async function MfaPage({ searchParams }: PageProps<"/admin/mfa">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : null;
  const session = await requireAdminSession({ allowAal1: true });
  if (session.aal === "aal2") redirect(safeAdminPath(nextPath));

  const view = await mfaViewFor(session);
  const footer = (
    <>
      <p className="text-muted-foreground">Signed in as {session.admin.email}</p>
      <SignOutButton />
    </>
  );

  switch (view) {
    case "verify":
      return (
        <AuthCard
          title="Enter your code"
          description="Open your authenticator app and type the 6 digit code for this store."
          footer={footer}
        >
          <TotpCodeForm next={nextPath} submitLabel="Verify" />
        </AuthCard>
      );
    case "setup":
    case "setup-pending":
      return (
        <AuthCard
          title="Set up your authenticator"
          description="Every admin signs in with a code from an authenticator app. Set it up once, now."
          footer={footer}
        >
          <TotpSetup next={nextPath} pending={view === "setup-pending"} />
        </AuthCard>
      );
    case "not-set-up":
      return (
        <AuthCard
          title="Authenticator needed"
          description="A password reset needs your authenticator app."
          footer={footer}
        >
          <FormNotice message={authMessages.mfa_not_set_up} />
        </AuthCard>
      );
    case "rate_limited":
    case "unavailable":
      return (
        <AuthCard
          title="Enter your code"
          description="Reload this page in a moment to try again."
          footer={footer}
        >
          <FormNotice message={authMessages[view]} />
        </AuthCard>
      );
  }
}
