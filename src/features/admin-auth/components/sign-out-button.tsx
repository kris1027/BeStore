import { Button } from "@/components/ui/button";

import { signOut } from "../actions/sign-out";

// A plain form, so it works before JavaScript loads; the MFA page always offers it (AC-4).
export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
