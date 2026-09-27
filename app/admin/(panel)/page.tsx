import type { Metadata } from "next";

import { Welcome } from "@/features/admin-auth/components/welcome";
import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";

// Reads the session or search params at the top level; allowed to block until converted
// to Suspense (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Welcome" });
}

export default async function AdminHomePage() {
  const admin = await requireAdmin();
  return <Welcome admin={admin} />;
}
