"use server";

import { after } from "next/server";

import { logAccountEvent } from "@/lib/customer/log";
import { fieldErrors } from "@/lib/form-errors";
import type { ActionResult } from "@/lib/result";
import { createSupabaseStatelessClient } from "@/lib/supabase/server";

import { emailFormSchema } from "../schemas";
import { settle } from "../settle";
import { sendSignUp } from "../sign-up-email";

export type EmailFormError = {
  readonly fields?: Partial<Record<"email", readonly string[]>>;
};

// spec 0012, AC-1: always the same "Check your email" answer, for a new email, an existing
// account (confirmed or not) and an admin's email. Supabase runs in after(), so neither the reply
// nor its timing reveals which; a failure (a rate limit, the hook) is only logged.
export async function signUp(values: unknown): Promise<ActionResult<null, EmailFormError>> {
  const parsed = emailFormSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };
  const { email } = parsed.data;

  after(() => sendSignUp(email));
  return { ok: true, data: null };
}

// AC-1: "Send the link again". The same answer whatever happens.
export async function resendConfirmation(
  values: unknown,
): Promise<ActionResult<null, EmailFormError>> {
  const parsed = emailFormSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };
  const { email } = parsed.data;

  after(async () => {
    const reason = await settle(() =>
      createSupabaseStatelessClient().auth.resend({ type: "signup", email }),
    );
    logAccountEvent("account.sign_up", {
      sent: reason === null,
      reason: reason === null ? "resend" : `resend_${reason}`,
    });
  });
  return { ok: true, data: null };
}
