import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";

import { logAuthEvent, requestIp } from "./log";
import { adminPathHeader, decideProxy } from "./proxy-decision";

// Runs on /admin and /auth only (see proxy.ts at the root), never on storefront routes (AC-1).
export async function adminAuthProxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(adminPathHeader, `${pathname}${search}`);

  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  let response = next();

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
          requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
          response = next();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // getClaims() refreshes an expired token and verifies it; it is the only auth call here.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  const decision = decideProxy({
    pathname,
    search,
    isServerAction: request.headers.has("next-action"),
    claims,
    nowMs: Date.now(),
  });

  if (decision.kind === "expire") {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      // auth-js keeps the local session when the Auth server call fails, so clear it here.
      for (const { name } of request.cookies.getAll()) {
        if (name.startsWith("sb-")) response.cookies.delete(name);
      }
    }
    logAuthEvent("auth.session.expired", {
      adminId: typeof claims?.sub === "string" ? claims.sub : null,
      ip: requestIp(request.headers),
    });
  }

  const target =
    decision.kind === "redirect" ? decision.to : decision.kind === "expire" ? decision.to : null;

  if (target !== null) {
    // A fresh redirect response drops the cookies set above, so copy them across.
    const redirect = NextResponse.redirect(new URL(target, request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    response = redirect;
  }

  // Admin pages must never come back from a cache, redirects included (AC-8).
  response.headers.set("Cache-Control", "no-store");
  return response;
}
