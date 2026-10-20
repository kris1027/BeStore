"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { legalPaths } from "@/lib/legal/paths";

import { useConsentState } from "./consent-provider";

const label = "Cookie settings";

// spec 0017, AC-16: in the server HTML (and with no ConsentProvider above, as on the 404 page)
// a plain link to /cookies; after hydration a button that opens the settings dialog.
export function CookieSettingsControl({ className }: { readonly className?: string }) {
  const state = useConsentState();
  if (state === null || !state.ready) {
    return (
      <Link href={legalPaths.cookies} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={state.openSettings}>
      {label}
    </button>
  );
}

// The button /cookies shows under its table; nothing before hydration, since it only opens the
// dialog.
export function CookieSettingsButton() {
  const state = useConsentState();
  if (state === null || !state.ready) return null;
  return (
    <Button variant="outline" className="h-11 self-start" onClick={state.openSettings}>
      {label}
    </Button>
  );
}
