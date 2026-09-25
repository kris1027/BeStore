import type { Metadata } from "next";

import { AuthFrame } from "@/features/admin-auth/components/auth-frame";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminAuthLayout({ children }: { readonly children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
