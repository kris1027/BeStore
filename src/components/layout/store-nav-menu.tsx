"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { currentHref, type NavItem } from "./nav";

type StoreNavProps = { readonly items: readonly NavItem[] };

export function StoreDesktopNav({ items }: StoreNavProps) {
  const pathname = usePathname();
  const current = currentHref(items, pathname);
  if (items.length === 0) return null;

  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.href === current ? "page" : undefined}
              className={cn(
                "inline-flex h-11 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
                "aria-[current=page]:font-medium aria-[current=page]:text-foreground",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Below md the header links move into a Sheet. The button only exists when there are links.
export function StoreMobileNav({ items }: StoreNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = currentHref(items, pathname);
  if (items.length === 0) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open menu"
        render={<Button variant="ghost" size="icon" className="-ml-2 size-11 md:hidden" />}
      >
        <MenuIcon aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <nav aria-label="Main" className="px-2">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={item.href === current ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className="flex h-11 items-center rounded-md px-2 text-base hover:bg-muted aria-[current=page]:font-medium"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
