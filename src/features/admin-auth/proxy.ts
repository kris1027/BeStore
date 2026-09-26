import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

import type { AdminRow } from "./access";
import { logAuthEvent, requestIp } from "./log";
import {
  type AdminGateDecision,
  adminPathHeader,
  decideAdminGate,
  decideProxy,
  needsAdminGate,
} from "./proxy-decision";

// No route matches it, so a rewrite here renders app/not-found.tsx with a real 404 status.
const deniedPath = "/admin/__denied";

type AdminRowLookup = { readonly ok: true; readonly row: AdminRow | null } | { readonly ok: false };

async function lookupAdminRow(id: string): Promise<AdminRowLookup> {
  try {
    const row = await db.adminUser.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, disabledAt: true },
    });
    return { ok: true, row };
  } catch {
    return { ok: false };
  }
}

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

  let gate: AdminGateDecision = { kind: "continue" };
  const gateInput = {
    pathname,
    search,
    method: request.method,
    isServerAction: request.headers.has("next-action"),
  };
  if (decision.kind === "continue" && claims !== null && needsAdminGate(gateInput)) {
    const adminId = typeof claims.sub === "string" ? claims.sub : null;
    const lookup =
      adminId === null ? { ok: true as const, row: null } : await lookupAdminRow(adminId);
    if (lookup.ok) {
      gate = decideAdminGate({ ...gateInput, claims, nowMs: Date.now(), adminRow: lookup.row });
    } else {
      // Fail open: the proxy is only the first gate, and the page's requireAdmin() still refuses.
      logAuthEvent("auth.proxy.lookup_failed", { adminId, ip: requestIp(request.headers) });
    }
    if (gate.kind === "not-found") {
      // requireAdmin() never runs for this request, so the denial is logged here.
      logAuthEvent("auth.access.denied", { adminId, ip: requestIp(request.headers) });
    }
  }

  const target =
    decision.kind === "redirect" || decision.kind === "expire"
      ? decision.to
      : gate.kind === "redirect"
        ? gate.to
        : null;

  if (gate.kind === "not-found") {
    const denied = NextResponse.rewrite(new URL(deniedPath, request.url), {
      request: { headers: requestHeaders },
    });
    for (const cookie of response.cookies.getAll()) denied.cookies.set(cookie);
    response = denied;
  } else if (target !== null) {
    // A fresh redirect response drops the cookies set above, so copy them across.
    const redirect = NextResponse.redirect(new URL(target, request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    response = redirect;
  }

  // Admin pages must never come back from a cache, redirects included (AC-8).
  response.headers.set("Cache-Control", "no-store");
  return response;
}
