import type { Metadata } from "next";
import { Suspense } from "react";

import { Settings, SettingsSkeleton } from "@/features/account/components/settings";

export const metadata: Metadata = {
  title: "Account settings",
  robots: { index: false, follow: false },
};

export default function AccountSettingsPage() {
  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4">
      <h2 id="settings-heading" className="font-heading text-2xl">
        Settings
      </h2>
      <Suspense fallback={<SettingsSkeleton />}>
        <Settings />
      </Suspense>
    </section>
  );
}
