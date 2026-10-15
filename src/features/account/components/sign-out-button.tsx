import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { signOutCustomer } from "../actions/sign-in";

// AC-6: a plain form, so it works before the page hydrates.
export function SignOutButton() {
  return (
    <form action={signOutCustomer}>
      <Button type="submit" variant="outline" size="lg">
        <LogOutIcon data-icon="inline-start" aria-hidden="true" />
        Sign out
      </Button>
    </form>
  );
}
