"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { legalPaths } from "@/lib/legal/paths";

import { acceptAllChoices, refusedAll } from "./consent";
import { useConsentState } from "./consent-provider";

// spec 0017, AC-18 and AC-19: a bar at the bottom of the viewport that blocks nothing and takes
// no focus. StoreShell places it right after the skip link, so keyboard and screen reader users
// reach it early. It renders nothing in the server HTML, so a returning visitor never sees it
// flash.
export function ConsentBanner() {
  const state = useConsentState();
  const ref = useRef<HTMLElement>(null);
  const showing = state?.showBanner === true;

  // WCAG 2.4.11: while the bar shows, the page scrolls a focused element clear of it.
  useEffect(() => {
    const banner = ref.current;
    if (!showing || banner === null) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.scrollPaddingBottom = `${banner.offsetHeight}px`;
    });
    observer.observe(banner);
    return () => {
      observer.disconnect();
      root.style.removeProperty("scroll-padding-bottom");
    };
  }, [showing]);

  if (state === null || !showing) return null;

  return (
    <section
      ref={ref}
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background shadow-lg print:hidden"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <p className="max-w-prose text-sm">
          We would like to use optional cookies to understand how the store is used. They stay off
          unless you say yes. Read the{" "}
          <Link href={legalPaths.cookies} className="underline underline-offset-4">
            cookie policy
          </Link>
          .
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:shrink-0">
          <Button
            variant="outline"
            className="h-11"
            onClick={() => state.save(acceptAllChoices(state.registry))}
          >
            Accept all
          </Button>
          <Button variant="outline" className="h-11" onClick={() => state.save(refusedAll)}>
            Reject all
          </Button>
          <Button variant="outline" className="h-11" onClick={state.openSettings}>
            Choose cookies
          </Button>
        </div>
      </div>
    </section>
  );
}
