"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { brand } from "@/lib/brand/brand";
import type { ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { classifyAuthError } from "../auth-errors";
import { factorToVerify, loadTotpFactors } from "../factors";
import { logAuthEvent, requestIp } from "../log";
import { countRecentWrongCodes, isLockedOut } from "../mfa-lockout";
import { requireAdminSession } from "../require-admin";
import { safeAdminPath, signInPath } from "../safe-admin-path";
import { totpCodeSchema } from "../schemas";
import { endLocalSession, fieldErrors } from "../session";

export type EnrollTotpData = {
  // An SVG data URL from Supabase, shown in an <img>.
  readonly qrCode: string;
  readonly secret: string;
};

export type EnrollTotpError = "mfa_not_set_up" | "rate_limited" | "unavailable";

// Started only by the "Set up authenticator" button, never on page render, so a reload,
// prefetch or second tab never replaces a QR code already scanned (AC-4).
export async function enrollTotp(): Promise<ActionResult<EnrollTotpData, EnrollTotpError>> {
  const session = await requireAdminSession({ allowAal1: true });
  if (session.fromResetLink) return { ok: false, error: "mfa_not_set_up" };

  const supabase = await createSupabaseServerClient();
  const loaded = await loadTotpFactors(supabase);
  if (!loaded.ok) return { ok: false, error: failureMessage(loaded.failure) };
  // Already enrolled: the page shows the verify view instead.
  if (loaded.factors.verified) redirect("/admin/mfa");

  // Leftover unverified factors go only now, when the admin asks for a new QR code.
  for (const factor of loaded.factors.unverified) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) return { ok: false, error: failureMessage(classifyAuthError(error)) };
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator",
    issuer: brand.name,
  });
  if (error) return { ok: false, error: failureMessage(classifyAuthError(error)) };

  return { ok: true, data: { qrCode: data.totp.qr_code, secret: data.totp.secret } };
}

export type VerifyTotpError = {
  readonly form?: "invalid_code" | "mfa_not_set_up" | "rate_limited" | "unavailable";
  readonly fields?: Partial<Record<"code", readonly string[]>>;
};

export async function verifyTotp(
  values: unknown,
  next: unknown,
): Promise<ActionResult<never, VerifyTotpError>> {
  const session = await requireAdminSession({ allowAal1: true });
  const target = safeAdminPath(next);
  if (session.aal === "aal2") redirect(target);

  const parsed = totpCodeSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };

  const ip = requestIp(await headers());
  const adminId = session.admin.id;
  const supabase = await createSupabaseServerClient();

  const loaded = await loadTotpFactors(supabase);
  if (!loaded.ok) return { ok: false, error: { form: failureMessage(loaded.failure) } };
  const factorId = factorToVerify(loaded.factors);
  const enrolling = loaded.factors.verified === null;
  // A reset link session may only verify a factor that already exists.
  if (factorId === null || (enrolling && session.fromResetLink)) {
    return { ok: false, error: { form: "mfa_not_set_up" } };
  }

  if (isLockedOut(await countRecentWrongCodes(factorId))) {
    await endLocalSession(supabase);
    logAuthEvent("auth.mfa.locked", { adminId, ip });
    redirect(signInPath({ reason: "too_many_codes" }));
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: parsed.data.code,
  });
  if (error) {
    const failure = classifyAuthError(error);
    if (failure !== "rejected") return { ok: false, error: { form: failureMessage(failure) } };
    logAuthEvent("auth.mfa.failed", { adminId, ip });
    return { ok: false, error: { form: "invalid_code" } };
  }

  if (enrolling) logAuthEvent("auth.mfa.enrolled", { adminId, ip });
  logAuthEvent("auth.mfa.succeeded", { adminId, ip });
  redirect(target);
}

function failureMessage(failure: "rate_limited" | "unavailable" | "rejected") {
  // A rejection outside the code check (an unexpected 4xx) is shown as an outage, never as a
  // hint about the account.
  return failure === "rate_limited" ? "rate_limited" : "unavailable";
}
