import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";

import { decideAccountProxy, isNoStorePath } from "./proxy-decision";

// Runs on /account and /checkout (see proxy.ts at the root), apart from the admin gate (spec 0012,
// AC-22): it refreshes the session and redirects signed out visitors from account pages.
export async function accountProxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          // The @supabase/ssr pattern: update the request so this render sees the new session,
          // and the response so the browser keeps it.
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // getClaims() refreshes an expired token and verifies it. The page's requireCustomer() asks the
  // Auth server itself (getUser), so a deleted account never gets further than this redirect hint.
  const { data } = await supabase.auth.getClaims();

  const decision = decideAccountProxy({
    pathname,
    search,
    isServerAction: request.headers.has("next-action"),
    signedIn: data?.claims != null,
  });
  if (decision.kind === "redirect") {
    // A fresh redirect response drops the cookies set above, so copy them across.
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    response = redirect;
  }

  if (isNoStorePath(pathname)) response.headers.set("Cache-Control", "no-store");
  return response;
}
