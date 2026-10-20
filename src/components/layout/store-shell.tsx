import Link from "next/link";
import { Suspense } from "react";

import { Wordmark } from "@/components/wordmark";
import { legalFooterLinks } from "@/features/legal/components/footer-links";
import { brand } from "@/lib/brand/brand";
import { CookieSettingsControl } from "@/lib/consent/cookie-settings-control";
import { cn } from "@/lib/utils";

import { storeContainer } from "./container";
import { FooterYear } from "./footer-year";
import type { NavItem } from "./nav";
import { StoreDesktopNav, StoreMobileNav } from "./store-nav-menu";
import { storeNavItems } from "./store-nav";

const footerLinkClass =
  "inline-flex min-h-6 cursor-pointer items-center text-sm text-muted-foreground hover:text-foreground";

type StoreShellProps = {
  // Header actions (search, account, cart), filled by features 13, 12 and 6.
  readonly actions?: React.ReactNode;
  // Footer links; the legal pages by default (spec 0017, AC-3), demo links in the style guide.
  readonly footerLinks?: readonly NavItem[];
  // The cookie consent bar, right after the skip link (spec 0017, AC-19). Only the store layout
  // and the style guide demo pass one.
  readonly banner?: React.ReactNode;
  // Defaults to the real list; the style guide passes demo links.
  readonly navItems?: readonly NavItem[];
  readonly children: React.ReactNode;
};

export function StoreShell({
  actions,
  footerLinks = legalFooterLinks,
  banner,
  navItems = storeNavItems,
  children,
}: StoreShellProps) {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {banner}
      {/* Printing a legal page prints only its text (AC-3). */}
      <header className="sticky top-0 z-40 h-(--header-height) border-b bg-background print:hidden">
        <div className={cn(storeContainer, "flex h-full items-center gap-4")}>
          <div className="flex items-center gap-1">
            {/* The navs read the pathname, which a route with unknown params (a product page)
                only knows at request time; Suspense keeps the rest of the shell static. */}
            <Suspense fallback={null}>
              <StoreMobileNav items={navItems} />
            </Suspense>
            <Wordmark />
          </div>
          <div className="flex min-w-0 flex-1 justify-center">
            <Suspense fallback={null}>
              <StoreDesktopNav items={navItems} />
            </Suspense>
          </div>
          <div className="flex items-center gap-1">{actions}</div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
      <footer className="border-t print:hidden">
        <div
          className={cn(
            storeContainer,
            "flex flex-col gap-6 py-10 md:flex-row md:items-end md:justify-between",
          )}
        >
          <div className="flex flex-col gap-2">
            <Wordmark className="self-start" />
            <p className="text-sm text-muted-foreground">
              © <FooterYear /> {brand.name}
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
                    <Link href={link.href} className={footerLinkClass}>
                      {link.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <CookieSettingsControl className={footerLinkClass} />
                </li>
              </ul>
            </nav>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
