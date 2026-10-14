import { requireCustomer } from "@/lib/customer/session";

import { AccountAuthCard } from "./auth-card";
import { SetPasswordForm } from "./set-password-form";

// spec 0012, AC-3 and AC-13: needs a session (from the confirm or reset link). `from=reset` only
// changes the wording.
export async function SetPassword({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCustomer();
  const from = (await searchParams).from === "reset" ? "reset" : "signup";
  return (
    <AccountAuthCard
      title={from === "reset" ? "Choose a new password" : "Choose your password"}
      description={
        from === "reset"
          ? "Your email is confirmed. Choose a new password; every other device is signed out."
          : "Your email is confirmed. Choose the password you will sign in with."
      }
    >
      <SetPasswordForm from={from} />
    </AccountAuthCard>
  );
}
