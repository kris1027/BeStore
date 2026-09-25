export type NavItem = {
  readonly href: string;
  readonly label: string;
};

// A nav item matches when the path is its href or sits below it, so /admin/orders/123 marks
// Orders. "/" only matches itself, or it would match every page.
export function matchesPath(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Only one item is current: the most specific match, so a dashboard at /admin does not stay
// marked on /admin/orders next to Orders.
export function currentHref(items: readonly NavItem[], pathname: string): string | undefined {
  return items
    .filter((item) => matchesPath(item.href, pathname))
    .reduce<string | undefined>(
      (best, item) => (best === undefined || item.href.length > best.length ? item.href : best),
      undefined,
    );
}
