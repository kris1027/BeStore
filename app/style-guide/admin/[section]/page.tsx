import type { Metadata } from "next";

import { demoSections } from "@/features/style-guide/admin-demo-nav";
import { AdminDemo } from "@/features/style-guide/components/admin-demo";

export const metadata: Metadata = { title: "Admin shell" };

// Only the demo nav's sections exist; any other segment is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return demoSections.map((section) => ({ section }));
}

export default async function Page({ params }: PageProps<"/style-guide/admin/[section]">) {
  const { section } = await params;
  return <AdminDemo section={section} />;
}
