import "server-only";

import { storeContainer } from "@/components/layout/container";
import { calendarDate, formatCalendarDate } from "@/lib/dates";
import { env } from "@/lib/env";
import { legalDocuments } from "@/lib/legal/documents";
import type { LegalSlug } from "@/lib/legal/paths";
import { fillPlaceholders } from "@/lib/legal/placeholders";
import type { PageSeo } from "@/lib/seo/metadata";
import { cn } from "@/lib/utils";

import { LegalMarkdown } from "./legal-markdown";

// spec 0017, AC-2 and spec 0018, AC-2: the front matter title and description on the shared
// page metadata (canonical, share card), and indexable.
export function legalSeo(slug: LegalSlug): PageSeo {
  const document = legalDocuments[slug];
  return { title: document.title, description: document.description, path: document.path };
}

// spec 0017, AC-1: the title as the only h1, the version date, then the body. It reads no
// request data, so every page prerenders; `/shipping` passes its live values (AC-5).
export function LegalPage({
  slug,
  values = {},
  children,
}: {
  readonly slug: LegalSlug;
  readonly values?: Readonly<Record<string, string>>;
  // What follows the text: the cookie table and settings button on /cookies.
  readonly children?: React.ReactNode;
}) {
  const document = legalDocuments[slug];
  return (
    <article className={cn(storeContainer, "flex flex-col gap-8 py-12 md:py-16")}>
      <header className="flex max-w-prose flex-col gap-3">
        <h1 className="font-heading text-4xl md:text-5xl">{document.title}</h1>
        <p className="text-sm text-muted-foreground">
          Last updated{" "}
          <time dateTime={document.updated}>
            {formatCalendarDate(calendarDate(document.updated), env.STORE_LOCALE)}
          </time>
        </p>
      </header>
      <div className="flex max-w-prose flex-col gap-8">
        <LegalMarkdown markdown={fillPlaceholders(document.body, values)} />
        {children}
      </div>
    </article>
  );
}
