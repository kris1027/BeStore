"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { currentHref, type NavItem } from "@/components/layout/nav";
import { cn } from "@/lib/utils";

import { accountPaths } from "../paths";

export const accountNavItems: readonly NavItem[] = [
  { href: accountPaths.home, label: "Orders" },
  { href: accountPaths.addresses, label: "Addresses" },
  { href: accountPaths.settings, label: "Settings" },
];

const linkClass = cn(
  "inline-flex h-11 items-center border-b-2 border-transparent px-1 text-muted-foreground transition-colors hover:text-foreground",
  "aria-[current=page]:border-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground",
);

// The account sections. The pathname is request data, so this sits behind Suspense; the fallback
// is the same list with nothing marked.
export function AccountNav() {
  const current = currentHref(accountNavItems, usePathname());
  return <AccountNavList current={current} />;
}

export function AccountNavList({ current }: { readonly current?: string }) {
  return (
    <nav aria-label="Account">
      <ul className="flex flex-wrap items-center gap-x-6">
        {accountNavItems.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.href === current ? "page" : undefined}
              className={linkClass}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
