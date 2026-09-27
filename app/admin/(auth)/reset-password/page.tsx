import type { Metadata } from "next";

import { AuthCard } from "@/features/admin-auth/components/auth-frame";
import { ResetPasswordForm } from "@/features/admin-auth/components/reset-password-form";
import { adminMetadata, requireAdminSession } from "@/features/admin-auth/require-admin";

// Reads the session or search params at the top level; allowed to block until converted
// to Suspense (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Choose a new password" });
}

// Needs aal2: the TOTP step comes before the new password, so the inbox alone is not enough.
export default async function ResetPasswordPage() {
  const { admin } = await requireAdminSession();

  return (
    <AuthCard
      title="Choose a new password"
      description={`For ${admin.email}. Saving it signs you out on every other device.`}
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
