import type { NextRequest } from "next/server";

import { adminAuthProxy } from "@/features/admin-auth/proxy";

// First gate only: refreshes the Supabase session and redirects signed out visitors.
// Every admin page, action and route handler still calls requireAdmin() itself.
export function proxy(request: NextRequest) {
  return adminAuthProxy(request);
}

// Storefront routes never reach Supabase (spec 0004, AC-1). Customer accounts (feature 12)
// widen this list.
export const config = {
  matcher: ["/admin/:path*", "/auth/:path*"],
};
