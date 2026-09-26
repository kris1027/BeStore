import { LayoutDashboardIcon, PackageIcon, ShoppingCartIcon, TagIcon } from "lucide-react";

import type { AdminNavItem } from "@/components/layout/admin-nav";

// Demo only: real admin routes use adminNavItems from src/components/layout/admin-nav.ts.
export const demoNav: readonly AdminNavItem[] = [
  { href: "/style-guide/admin", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/style-guide/admin/orders", label: "Orders", icon: ShoppingCartIcon },
  { href: "/style-guide/admin/products", label: "Products", icon: PackageIcon },
  { href: "/style-guide/admin/discounts", label: "Discounts", icon: TagIcon },
];

// Every demo link needs a page behind it (app/style-guide/admin/[section]), or each production
// prefetch logs a 404. A plain module, not the client component, so the server page can read it.
export const demoSections = demoNav
  .map((item) => item.href.replace("/style-guide/admin", "").replace("/", ""))
  .filter((section) => section !== "");
