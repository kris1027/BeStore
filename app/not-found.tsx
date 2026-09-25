import type { Metadata } from "next";
import Link from "next/link";

import { StoreShell } from "@/components/layout/store-shell";
import { StatusPage } from "@/components/status-page";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <StoreShell>
      <StatusPage
        eyebrow="404"
        title="We can't find that page"
        description="The link may be old, or the page may have moved. Try the home page instead."
        actions={
          <Link href="/" className={buttonVariants({ size: "lg", className: "h-11 px-5" })}>
            Go to the home page
          </Link>
        }
      />
    </StoreShell>
  );
}
