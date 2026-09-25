"use server";

import { headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { logAuthEvent, requestIp } from "../log";
import { signInPath } from "../safe-admin-path";
import { endLocalSession } from "../session";

// The one admin action without requireAdmin(): it only ends the caller's own session on this
// device, so it must work from any state (aal1, expired, disabled) and grants nothing.
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  await endLocalSession(supabase);
  logAuthEvent("auth.sign_out", {
    adminId: typeof data?.claims.sub === "string" ? data.claims.sub : null,
    ip: requestIp(await headers()),
  });
  // Replace, not push, so Back does not land on the admin page that was just left (AC-8).
  redirect(signInPath({ reason: "signed_out" }), RedirectType.replace);
}
