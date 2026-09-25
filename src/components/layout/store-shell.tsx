import Link from "next/link";

import { Wordmark } from "@/components/wordmark";
import { brand } from "@/lib/brand/brand";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

import { storeContainer } from "./container";
import type { NavItem } from "./nav";
import { StoreDesktopNav, StoreMobileNav } from "./store-nav-menu";
import { storeNavItems } from "./store-nav";

type StoreShellProps = {
  // Header actions (search, account, cart), filled by features 13, 12 and 6.
  readonly actions?: React.ReactNode;
  // Footer links (legal pages, feature 16).
  readonly footerLinks?: readonly NavItem[];
  // Defaults to the real list; the style guide passes demo links.
  readonly navItems?: readonly NavItem[];
  readonly children: React.ReactNode;
};

export function StoreShell({
  actions,
  footerLinks = [],
  navItems = storeNavItems,
  children,
}: StoreShellProps) {
  // The store's year, not the server's: on New Year's Eve they can differ. A static page
  // freezes it at build time until the next deploy, which is fine for a year.
  const year = new Intl.DateTimeFormat("en", {
    year: "numeric",
    timeZone: env.STORE_TIMEZONE,
  }).format(new Date());

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 h-(--header-height) border-b bg-background">
        <div className={cn(storeContainer, "flex h-full items-center gap-4")}>
          <div className="flex items-center gap-1">
            <StoreMobileNav items={navItems} />
            <Wordmark />
          </div>
          <div className="flex flex-1 justify-center">
            <StoreDesktopNav items={navItems} />
          </div>
          <div className="flex items-center gap-1">{actions}</div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
      <footer className="border-t">
        <div
          className={cn(
            storeContainer,
            "flex flex-col gap-6 py-10 md:flex-row md:items-end md:justify-between",
          )}
        >
          <div className="flex flex-col gap-2">
            <Wordmark className="self-start" />
            <p className="text-sm text-muted-foreground">
              © {year} {brand.name}
            </p>
            {brand.contactEmail ? (
              <a
                href={`mailto:${brand.contactEmail}`}
                className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {brand.contactEmail}
              </a>
            ) : null}
          </div>
          {footerLinks.length > 0 ? (
            <nav aria-label="Footer">
              <ul className="flex flex-wrap gap-x-6 gap-y-2">
                {footerLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-6 items-center text-sm text-muted-foreground hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
