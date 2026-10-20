import type { NavItem } from "@/components/layout/nav";
import { legalLinkLabels, legalPaths, legalSlugs } from "@/lib/legal/paths";

// spec 0017, AC-3: the store footer's links, in the order the spec fixes. StoreShell uses them
// by default, so app/not-found.tsx gets them too.
export const legalFooterLinks: readonly NavItem[] = legalSlugs.map((slug) => ({
  href: legalPaths[slug],
  label: legalLinkLabels[slug],
}));
