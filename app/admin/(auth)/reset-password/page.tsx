import type { Metadata } from "next";

import { AuthCard } from "@/features/admin-auth/components/auth-frame";
import { ResetPasswordForm } from "@/features/admin-auth/components/reset-password-form";
import { requireAdminSession } from "@/features/admin-auth/require-admin";

export const metadata: Metadata = { title: "Choose a new password" };

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
