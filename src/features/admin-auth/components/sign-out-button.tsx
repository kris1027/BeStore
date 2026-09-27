import { Button } from "@/components/ui/button";

import { signOutPath } from "../safe-admin-path";

// A plain form POST, so it works before JavaScript loads; the MFA page always offers it (AC-4).
export function SignOutButton() {
  return (
    <form method="post" action={signOutPath}>
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
