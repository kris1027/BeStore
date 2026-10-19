import type { Metadata } from "next";
import { connection } from "next/server";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { DashboardPage } from "@/features/dashboard/components/dashboard-page";
import { dayText, parseSalesWindow } from "@/features/dashboard/period";
import { storeToday } from "@/lib/dates";
import { env } from "@/lib/env";

// Reads the session or search params at the top level; allowed to block until converted
// to Suspense (spec 0005, Caching model). The figures stream in behind their own Suspense.
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Dashboard" });
}

// spec 0015: the sales dashboard is the panel's landing page.
export default async function AdminDashboardPage({ searchParams }: PageProps<"/admin">) {
  const admin = await requireAdmin();
  // "Today" is read per request, never baked into a prerender.
  await connection();
  const today = storeToday(new Date(), env.STORE_TIMEZONE);
  const window = parseSalesWindow(await searchParams, today, env.STORE_TIMEZONE);
  return (
    <DashboardPage
      adminName={admin.name}
      window={window}
      today={dayText(today)}
      money={{ currency: env.STORE_CURRENCY, locale: env.STORE_LOCALE }}
    />
  );
}
