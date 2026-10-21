"use client";

import type { OptionalCategory } from "./consent";
import { useConsent } from "./consent-provider";

// spec 0017, AC-22: renders its children only once mounted and the category is granted, so no
// tracking script reaches the page before consent. Feature 18 wraps its scripts in it.
export function ConsentGate({
  category,
  children,
}: {
  readonly category: OptionalCategory;
  readonly children: React.ReactNode;
}) {
  const consent = useConsent();
  return consent.ready && consent[category] ? children : null;
}
