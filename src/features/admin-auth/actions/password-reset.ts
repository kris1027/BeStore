"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/result";
import { createSupabaseServerClient, createSupabaseStatelessClient } from "@/lib/supabase/server";

import { classifyAuthError } from "../auth-errors";
import { logAuthEvent, requestIp } from "../log";
import { requireAdminSession } from "../require-admin";
import { mfaPath, signInPath } from "../safe-admin-path";
import { forgotPasswordSchema, resetPasswordSchema } from "../schemas";
import { fieldErrors } from "../session";

export type RequestResetError = {
  readonly fields?: Partial<Record<"email", readonly string[]>>;
};

// Always the same answer, whether or not the email belongs to an admin (AC-9). The Supabase
// call runs in after(), so the reply takes the same path and time either way.
export async function requestPasswordReset(
  values: unknown,
): Promise<ActionResult<null, RequestResetError>> {
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };

  const { email } = parsed.data;
  const ip = requestIp(await headers());
  // Only active admins get the admin template; a future customer with that email gets nothing.
  const admin = await db.adminUser.findFirst({
    where: { email, disabledAt: null },
    select: { id: true },
  });

  after(async () => {
    if (!admin) {
      logAuthEvent("auth.reset.requested", { email, ip, sent: false });
      return;
    }
    const { error } = await createSupabaseStatelessClient().auth.resetPasswordForEmail(email);
    if (error) {
      logger.error(
        { adminId: admin.id, reason: classifyAuthError(error) },
        "auth.reset.send_failed",
      );
    }
    logAuthEvent("auth.reset.requested", { adminId: admin.id, ip, sent: !error });
  });

  return { ok: true, data: null };
}

const confirmSchema = z.object({
  token_hash: z.string().min(1),
  type: z.literal("recovery"),
});

// The POST half of /auth/confirm: only a person pressing Continue spends the one time token,
// never a mail scanner that opens the link (spec 0004).
export async function confirmResetLink(formData: FormData): Promise<void> {
  const parsed = confirmSchema.safeParse({
    token_hash: formData.get("token_hash"),
    type: formData.get("type"),
  });
  if (!parsed.success) redirect(signInPath({ reason: "invalid_link" }));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: parsed.data.token_hash,
  });
  if (error) redirect(signInPath({ reason: "invalid_link" }));

  // The new password waits behind the TOTP step: the inbox alone is not enough.
  redirect(mfaPath("/admin/reset-password"));
}

export type ResetPasswordError = {
  readonly form?: "same_password" | "unavailable";
  readonly fields?: Partial<Record<"password" | "confirm", readonly string[]>>;
};

export async function resetPassword(
  values: unknown,
): Promise<ActionResult<never, ResetPasswordError>> {
  const { admin } = await requireAdminSession();

  const parsed = resetPasswordSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { ok: false, error: { form: "same_password" } };
    // The schema mirrors the Supabase policy, so a weak password rejection means the two drifted.
    if (error.code === "weak_password") {
      logger.error({ adminId: admin.id }, "auth.password.policy_mismatch");
    }
    return { ok: false, error: { form: "unavailable" } };
  }

  // Whoever else holds a session (perhaps the reason for the reset) is signed out everywhere.
  // The password is changed either way; a failed revoke is logged because the other sessions
  // may still be live.
  const { error: revokeError } = await supabase.auth.signOut({ scope: "others" });
  if (revokeError) {
    logger.error(
      { adminId: admin.id, reason: classifyAuthError(revokeError) },
      "auth.password.revoke_others_failed",
    );
  }
  logAuthEvent("auth.password.changed", { adminId: admin.id, ip: requestIp(await headers()) });
  redirect("/admin");
}
