import "server-only";

import { logAccountEvent } from "@/lib/customer/log";
import { createSupabaseStatelessClient } from "@/lib/supabase/server";

import { settle } from "./settle";
import { throwawayPassword } from "./throwaway-password";

// spec 0012, AC-1: the Supabase sign up behind signUp and signUpFromOrder (AC-17), always run in
// after(). Supabase sends the confirm email through the hook for a new or unconfirmed account and
// nothing for a confirmed one; either way the visitor saw the same reply.
export async function sendSignUp(email: string): Promise<void> {
  const reason = await settle(() =>
    createSupabaseStatelessClient().auth.signUp({ email, password: throwawayPassword() }),
  );
  logAccountEvent("account.sign_up", { sent: reason === null, ...(reason ? { reason } : {}) });
}
