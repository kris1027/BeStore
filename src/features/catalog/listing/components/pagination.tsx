import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { pageItems } from "../pagination";

const pageLink = cn(buttonVariants({ variant: "ghost" }), "size-11 px-0 tabular-nums");

// spec 0013, AC-5: numbered page links; none at all for a single page. Plain links, so paging
// works without JavaScript and every page has its own URL.
export function Pagination({
  page: current,
  pageCount,
  pageHref: href,
}: {
  readonly page: number;
  readonly pageCount: number;
  readonly pageHref: (page: number) => string;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Pagination" className="flex justify-center">
      <ul className="flex flex-wrap items-center gap-1">
        {current > 1 ? (
          <li>
            <Link
              href={href(current - 1)}
              className={cn(buttonVariants({ variant: "ghost" }), "h-11")}
            >
              <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
              Previous
            </Link>
          </li>
        ) : null}
        {pageItems(current, pageCount).map((item, index) =>
          item.kind === "gap" ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-2 text-muted-foreground">
              …
            </li>
          ) : (
            <li key={item.page}>
              <Link
                href={href(item.page)}
                aria-current={item.page === current ? "page" : undefined}
                aria-label={`Page ${item.page}`}
                className={cn(
                  pageLink,
                  item.page === current &&
                    "bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground",
                )}
              >
                {item.page}
              </Link>
            </li>
          ),
        )}
        {current < pageCount ? (
          <li>
            <Link
              href={href(current + 1)}
              className={cn(buttonVariants({ variant: "ghost" }), "h-11")}
            >
              Next
              <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
