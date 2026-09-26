"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { classifyAuthError } from "../auth-errors";
import { logAuthEvent, requestIp } from "../log";
import { mfaPath } from "../safe-admin-path";
import { signInSchema } from "../schemas";
import { endLocalSession, fieldErrors } from "../session";

export type SignInError = {
  readonly form?: "invalid_credentials" | "rate_limited" | "unavailable";
  readonly fields?: Partial<Record<"email" | "password", readonly string[]>>;
};

// Public by design: this is how an admin gets a session. The Vercel Firewall limits it per IP.
export async function signIn(
  values: unknown,
  next: unknown,
): Promise<ActionResult<never, SignInError>> {
  const parsed = signInSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };

  const { email, password } = parsed.data;
  const ip = requestIp(await headers());
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const failure = classifyAuthError(error);
    const reason = failure === "rejected" ? "invalid_credentials" : failure;
    logAuthEvent("auth.sign_in.failed", { email, ip, reason });
    return { ok: false, error: { form: reason } };
  }

  const admin = await db.adminUser.findUnique({
    where: { id: data.user.id },
    select: { id: true, disabledAt: true },
  });
  if (!admin || admin.disabledAt !== null) {
    // Valid credentials for someone who is not an active admin: end that session at once and
    // answer exactly as for a wrong password, so the form cannot reveal who is an admin.
    await endLocalSession(supabase);
    logAuthEvent("auth.sign_in.failed", { email, ip, reason: "not_admin" });
    return { ok: false, error: { form: "invalid_credentials" } };
  }

  logAuthEvent("auth.sign_in.succeeded", { adminId: admin.id, ip });
  redirect(mfaPath(typeof next === "string" ? next : undefined));
}
