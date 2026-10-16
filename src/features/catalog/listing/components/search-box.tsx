"use client";

import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

import { searchPath } from "../../paths";

// spec 0013, AC-6: a GET form to /search, so it works without JavaScript. The text is never
// logged or sent anywhere else (AC-10).
export function SearchForm({
  id,
  label,
  defaultValue,
  className,
}: {
  readonly id: string;
  // The landmark's name: the header box and the /search box both sit on /search.
  readonly label: string;
  readonly defaultValue?: string;
  readonly className?: string;
}) {
  return (
    <form
      role="search"
      aria-label={label}
      action={searchPath}
      className={cn("flex items-center gap-2", className)}
    >
      <Label htmlFor={id} className="sr-only">
        Search products
      </Label>
      <Input
        id={id}
        type="search"
        name="q"
        defaultValue={defaultValue}
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Search products"
        className="h-11 min-w-0 flex-1"
      />
      <Button type="submit" variant="outline" size="icon" aria-label="Search" className="size-11">
        <SearchIcon aria-hidden="true" />
      </Button>
    </form>
  );
}

// The header box never prefills: that would need the search params in the layout (spec 0013,
// Decision). Below lg it sits behind a Search button; before hydration that button is a plain
// link to /search, which has its own box.
export function HeaderSearch() {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);

  return (
    <>
      <SearchForm id="header-search" label="Store search" className="hidden w-64 lg:flex" />
      {hydrated ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            aria-label="Search"
            render={<Button variant="ghost" size="icon" className="size-11 lg:hidden" />}
          >
            <SearchIcon className="size-5" aria-hidden="true" />
          </SheetTrigger>
          <SheetContent side="top">
            <SheetHeader>
              <SheetTitle>Search</SheetTitle>
            </SheetHeader>
            <SearchForm id="header-search-mobile" label="Store search" className="px-4 pb-6" />
          </SheetContent>
        </Sheet>
      ) : (
        <Link
          href={searchPath}
          aria-label="Search"
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-11 lg:hidden")}
        >
          <SearchIcon className="size-5" aria-hidden="true" />
        </Link>
      )}
    </>
  );
}
