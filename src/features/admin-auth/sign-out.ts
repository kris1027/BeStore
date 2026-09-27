import "server-only";

import { type NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { logAuthEvent, requestIp } from "./log";
import { signInPath } from "./safe-admin-path";
import { endLocalSession } from "./session";

// The one admin route without requireAdmin(): it only ends the caller's own session on this
// device, so it must work from any state (aal1, expired, disabled) and grants nothing.
// A plain form POST and a 303, so the browser does a full page load and Cache Components keeps
// no admin page alive for Back (spec 0005, AC-20).
export async function signOutRequest(request: NextRequest): Promise<Response> {
  // A route handler has no built in CSRF check (server actions do): without this, any site
  // could sign an admin out with a cross site form.
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  await endLocalSession(supabase);
  logAuthEvent("auth.sign_out", {
    adminId: typeof data?.claims.sub === "string" ? data.claims.sub : null,
    ip: requestIp(request.headers),
  });

  const response = NextResponse.redirect(
    new URL(signInPath({ reason: "signed_out" }), request.url),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
