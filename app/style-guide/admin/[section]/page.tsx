import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { demoSections } from "@/features/style-guide/admin-demo-nav";
import { AdminDemo } from "@/features/style-guide/components/admin-demo";

export const metadata: Metadata = { title: "Admin shell" };

export function generateStaticParams() {
  return demoSections.map((section) => ({ section }));
}

export default async function Page({ params }: PageProps<"/style-guide/admin/[section]">) {
  const { section } = await params;
  // Only the demo nav's sections exist; any other segment is a 404 (Cache Components has no
  // `dynamicParams = false`).
  if (!demoSections.includes(section)) notFound();
  return <AdminDemo section={section} />;
}
