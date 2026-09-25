import type { Metadata } from "next";

import { adminNavItems } from "@/components/layout/admin-nav";
import { AdminShell } from "@/components/layout/admin-shell";
import { UserMenu } from "@/features/admin-auth/components/user-menu";
import { requireAdmin } from "@/features/admin-auth/require-admin";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

// Layouts do not re-run on every client navigation, so this call only feeds the user menu:
// every panel page and admin action calls requireAdmin() itself.
export default async function AdminPanelLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <AdminShell nav={adminNavItems} userMenu={<UserMenu name={admin.name} email={admin.email} />}>
      {children}
    </AdminShell>
  );
}
