import Link from "next/link";

import { brand } from "@/lib/brand/brand";
import { cn } from "@/lib/utils";

// The brand name set in the heading font; there is no logo file yet (spec 0003).
export function Wordmark({ className }: { readonly className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "font-heading text-xl font-medium tracking-tight text-foreground md:text-2xl",
        className,
      )}
    >
      {brand.name}
    </Link>
  );
}
