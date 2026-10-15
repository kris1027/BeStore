import type { NextRequest } from "next/server";

import { accountProxy } from "@/features/account/proxy";
import { adminAuthProxy } from "@/features/admin-auth/proxy";

// First gate only: refreshes the Supabase session and redirects signed out visitors. Every admin
// page, action and route handler still calls requireAdmin() itself, and every account page and
// action requireCustomer() (spec 0012, AC-13).
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/admin") || pathname.startsWith("/auth")) {
    return adminAuthProxy(request);
  }
  return accountProxy(request);
}

// Catalog pages never reach Supabase and stay cached (spec 0004, AC-1; spec 0012, AC-22).
export const config = {
  matcher: ["/admin/:path*", "/auth/:path*", "/account/:path*", "/checkout/:path*"],
};
