import type { Metadata } from "next";

import { AdminShell } from "@/components/layout/admin-shell";
import { UserMenu } from "@/features/admin-auth/components/user-menu";
import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";

// Reads the session or search params at the top level; allowed to block until converted
// to Suspense (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata(
    {
      title: { default: "Admin", template: "%s · Admin" },
      robots: { index: false, follow: false },
    },
    { layout: true },
  );
}

// Layouts do not re-run on every client navigation, so this call only feeds the user menu:
// every panel page and admin action calls requireAdmin() itself.
export default async function AdminPanelLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <AdminShell userMenu={<UserMenu name={admin.name} email={admin.email} />}>
      {children}
    </AdminShell>
  );
}
