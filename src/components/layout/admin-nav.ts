import {
  FolderTreeIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  PackageIcon,
  ReceiptIcon,
  SettingsIcon,
  TicketPercentIcon,
} from "lucide-react";

import type { NavItem } from "./nav";

export type AdminNavItem = NavItem & {
  readonly icon: LucideIcon;
};

// Only sections that exist are listed; each admin feature appends its own entry.
export const adminNavItems: readonly AdminNavItem[] = [
  // Only marked on /admin itself: currentHref picks the most specific match (spec 0015, AC-1).
  { href: "/admin", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/admin/products", label: "Products", icon: PackageIcon },
  { href: "/admin/categories", label: "Categories", icon: FolderTreeIcon },
  { href: "/admin/orders", label: "Orders", icon: ReceiptIcon },
  { href: "/admin/discounts", label: "Discounts", icon: TicketPercentIcon },
  { href: "/admin/settings", label: "Settings", icon: SettingsIcon },
];
