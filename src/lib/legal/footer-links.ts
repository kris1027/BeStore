import type { NavItem } from "@/components/layout/nav";

import { legalLinkLabels, legalPaths, legalSlugs } from "./paths";

// spec 0017, AC-3: the store footer's links, in the order the spec fixes. StoreShell uses them
// by default, so app/not-found.tsx gets them too. Shared code, so the shell never imports a
// feature.
export const legalFooterLinks: readonly NavItem[] = legalSlugs.map((slug) => ({
  href: legalPaths[slug],
  label: legalLinkLabels[slug],
}));
