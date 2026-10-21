"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import type { CookieRegistry } from "@/lib/consent/consent";
import { ConsentGate } from "@/lib/consent/consent-gate";
import { useConsent } from "@/lib/consent/consent-provider";

// spec 0017, AC-24: the real registry has no optional cookie, so the banner never shows in the
// store. This demo registry adds one analytics cookie, set by the demo only, so the banner, the
// dialog and the withdrawal reload can be tried and tested end to end.
export const DEMO_ANALYTICS_COOKIE = "demo_analytics";

export const demoRegistry: CookieRegistry = [
  {
    name: DEMO_ANALYTICS_COOKIE,
    match: DEMO_ANALYTICS_COOKIE,
    category: "analytics",
    purpose: "A stand in analytics cookie, set by the style guide demo only.",
    lifetime: "Session",
    setBy: "The style guide demo",
  },
];

// Its own version, so a choice made here never grants anything in the real store.
export const demoPolicyVersion = "style-guide-demo";

function DemoAnalyticsCookie() {
  useEffect(() => {
    document.cookie = `${DEMO_ANALYTICS_COOKIE}=1; Path=/; SameSite=Lax`;
  }, []);
  return null;
}

export function ConsentDemo() {
  const consent = useConsent();
  const state = !consent.ready ? "Waiting for the page to load" : consent.analytics ? "On" : "Off";
  return (
    <div className="flex flex-col gap-4">
      <ConsentGate category="analytics">
        <DemoAnalyticsCookie />
      </ConsentGate>
      <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Demo analytics</dt>
        <dd className="text-right" data-testid="consent-demo-analytics">
          {state}
        </dd>
      </dl>
      <Button
        variant="outline"
        className="h-11 self-start"
        disabled={!consent.ready}
        onClick={consent.openSettings}
      >
        Open cookie settings
      </Button>
    </div>
  );
}
