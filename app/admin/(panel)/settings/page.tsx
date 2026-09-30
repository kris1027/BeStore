import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { getAdminShippingSettings } from "@/features/settings/admin-queries";
import { SettingsPage } from "@/features/settings/components/settings-page";

// Reads the session at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Settings" });
}

export default async function AdminSettingsPage() {
  await requireAdmin();
  return <SettingsPage shipping={await getAdminShippingSettings()} />;
}
