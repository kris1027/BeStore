import type { Metadata } from "next";

import { Welcome } from "@/features/admin-auth/components/welcome";
import { requireAdmin } from "@/features/admin-auth/require-admin";

export const metadata: Metadata = { title: "Welcome" };

export default async function AdminHomePage() {
  const admin = await requireAdmin();
  return <Welcome admin={admin} />;
}
