import { type LucideIcon, PackageIcon } from "lucide-react";

import type { NavItem } from "./nav";

export type AdminNavItem = NavItem & {
  readonly icon: LucideIcon;
};

// Only sections that exist are listed; each admin feature appends its own entry.
export const adminNavItems: readonly AdminNavItem[] = [
  { href: "/admin/products", label: "Products", icon: PackageIcon },
];
