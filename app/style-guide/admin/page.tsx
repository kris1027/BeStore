import type { Metadata } from "next";

import { AdminDemo } from "@/features/style-guide/components/admin-demo";

export const metadata: Metadata = { title: "Admin shell" };

export default function Page() {
  return <AdminDemo />;
}
