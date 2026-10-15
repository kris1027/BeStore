import { UserIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { accountPaths } from "../paths";

// spec 0012, AC-22: the same plain link for everyone. It never reads the session, so the catalog
// pages keep their static shell and never call Supabase; /account sends a signed out visitor on.
export function AccountLink() {
  return (
    <Link
      href={accountPaths.home}
      aria-label="Account"
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-11")}
    >
      <UserIcon className="size-5" aria-hidden="true" />
    </Link>
  );
}
