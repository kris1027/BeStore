import type { Metadata } from "next";

import { Welcome } from "@/features/admin-auth/components/welcome";
import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Welcome" });
}

export default async function AdminHomePage() {
  const admin = await requireAdmin();
  return <Welcome admin={admin} />;
}
