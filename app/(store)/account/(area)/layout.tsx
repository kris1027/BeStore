import { Suspense } from "react";

import { storeContainer } from "@/components/layout/container";
import { AccountNav, AccountNavList } from "@/features/account/components/account-nav";
import { SignOutButton } from "@/features/account/components/sign-out-button";
import { cn } from "@/lib/utils";

// The signed in account area (spec 0012, AC-11 to AC-20). Static: each page reads the session
// itself, inside its own Suspense boundary (AC-25).
export default function AccountAreaLayout({ children }: LayoutProps<"/account">) {
  return (
    <div className={cn(storeContainer, "flex flex-col gap-8 py-12 md:py-16")}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-heading text-4xl md:text-5xl">Your account</h1>
        <SignOutButton />
      </div>
      <div className="border-b">
        <Suspense fallback={<AccountNavList />}>
          <AccountNav />
        </Suspense>
      </div>
      {children}
    </div>
  );
}
