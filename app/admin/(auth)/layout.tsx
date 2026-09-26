import type { Metadata } from "next";

import { AuthFrame } from "@/features/admin-auth/components/auth-frame";

// Reads the session or search params at the top level; allowed to block until converted
// to Suspense (spec 0005, Caching model).
export const instant = false;

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminAuthLayout({ children }: { readonly children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
