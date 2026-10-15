import "server-only";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { accountPaths } from "./paths";

// spec 0012, AC-4: a visitor who already has any session (a customer, or an admin signed in at
// /admin) and opens sign in or sign up goes to /account, so a customer sign in never replaces a
// live admin session. getUser() asks the Auth server, so a dead session still sees the form.
export async function redirectIfSignedIn(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(accountPaths.home);
}
