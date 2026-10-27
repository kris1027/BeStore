"use server";

import { after } from "next/server";

import { logAccountEvent } from "@/lib/customer/log";
import { env } from "@/lib/env";
import { fieldErrors } from "@/lib/form-errors";
import type { ActionResult } from "@/lib/result";
import { createSupabaseStatelessClient } from "@/lib/supabase/server";

import { accountPaths } from "../paths";
import { type EmailFormError, emailFormSchema } from "../schemas";
import { settle } from "../settle";

// spec 0012, AC-9: the same reply for any email, at the same speed: Supabase runs in after(). The
// Send Email Hook decides what is sent (AC-8): a user who runs the store gets nothing, whatever
// redirect this asks for (spec 0019, AC-8).
export async function requestPasswordReset(
  values: unknown,
): Promise<ActionResult<null, EmailFormError>> {
  const parsed = emailFormSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };
  const { email } = parsed.data;

  after(async () => {
    const reason = await settle(() =>
      createSupabaseStatelessClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${env.NEXT_PUBLIC_SITE_URL}${accountPaths.setPassword}`,
      }),
    );
    logAccountEvent("account.reset_requested", {
      sent: reason === null,
      ...(reason ? { reason } : {}),
    });
  });
  return { ok: true, data: null };
}
