"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/components/wordmark";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

import type { AdminNavItem } from "./admin-nav";
import { currentHref } from "./nav";

type AdminShellProps = {
  // Real admin routes pass adminNavItems; the style guide passes demo items.
  readonly nav: readonly AdminNavItem[];
  // Sign out and the admin's name (feature 5).
  readonly userMenu?: React.ReactNode;
  readonly children: React.ReactNode;
};

// Layout only: it grants nothing. Every admin page and action still calls requireAdmin() itself.
export function AdminShell({ nav, userMenu, children }: AdminShellProps) {
  return (
    // All admin text is Inter (spec 0003): the heading font token points at the sans font here,
    // so shadcn titles that use font-heading follow without per component overrides.
    <SidebarProvider className="[--font-heading:var(--font-sans)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <AdminSidebar nav={nav} />
      <SidebarInset id="main" tabIndex={-1}>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="flex items-center gap-2">
            <Wordmark className="text-lg md:text-xl" />
            <Badge variant="secondary">Admin</Badge>
          </div>
          <div className="ml-auto flex items-center gap-2">{userMenu}</div>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

// Split out so useSidebar() runs inside SidebarProvider.
function AdminSidebar({ nav }: { readonly nav: readonly AdminNavItem[] }) {
  const pathname = usePathname();
  const current = currentHref(nav, pathname);
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Admin">
              <SidebarMenu>
                {nav.map((item) => {
                  const isCurrent = item.href === current;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isCurrent}
                        render={
                          <Link
                            href={item.href}
                            aria-current={isCurrent ? "page" : undefined}
                            // The shell stays mounted across admin pages, so the phone
                            // sheet would otherwise stay open over the page just opened.
                            onClick={() => setOpenMobile(false)}
                          />
                        }
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
