import type { SellerDetails } from "@/lib/brand/brand";

import { parseFrontMatter } from "./front-matter";
import { legalPaths, type LegalSlug, legalSlugs } from "./paths";
import { fillPlaceholders, findFillMarkers, toFillMarker } from "./placeholders";

// Pure. The five raw legal files to the documents the pages render (spec 0017, AC-1 and AC-4).
// documents.ts runs it once at module load, so any throw here fails the build and `pnpm test`.

export type LegalDocument = {
  readonly slug: LegalSlug;
  readonly path: `/${LegalSlug}`;
  readonly title: string;
  readonly description: string;
  // The front matter date, YYYY-MM-DD: the text's version.
  readonly updated: string;
  // Seller placeholders filled; `/shipping` still holds its live ones (AC-5).
  readonly body: string;
};

// Filled per render from the cached settings read, so an admin save shows with no deploy.
export const shippingPlaceholders = ["deliveryFee", "freeDeliveryRule"] as const;

const sellerKeys = ["name", "address", "taxId", "registration", "email", "phone"] as const;

// A null field renders its own marker (`[[TO FILL: seller.address]]`), which the production
// guard then catches.
export function sellerValues(seller: SellerDetails): Readonly<Record<string, string>> {
  return Object.fromEntries(
    sellerKeys.map((key) => [`seller.${key}`, seller[key] ?? toFillMarker(`seller.${key}`)]),
  );
}

// The draft note is an HTML comment at the top. It goes before the marker check, so the note may
// mention the marker without tripping the guard (the renderer skips raw HTML anyway).
export function stripLeadingComments(body: string): string {
  return body.replace(/^\s*(?:<!--[\s\S]*?-->\s*)+/, "");
}

// What the env fixes for the whole store: the one country served and the price currency, named
// as the sources in the content outline (spec 0017).
export type StoreFacts = { readonly country: string; readonly currency: string };

export function loadLegalDocuments(
  raw: Readonly<Record<LegalSlug, string>>,
  options: {
    readonly seller: SellerDetails;
    readonly store: StoreFacts;
    readonly production: boolean;
  },
): Readonly<Record<LegalSlug, LegalDocument>> {
  const values = {
    ...sellerValues(options.seller),
    "store.country": options.store.country,
    "store.currency": options.store.currency,
  };
  const entries = legalSlugs.map((slug): [LegalSlug, LegalDocument] => {
    const name = `src/lib/legal/content/${slug}.md`;
    const { meta, body } = parseFrontMatter(raw[slug], name);
    const keep = slug === "shipping" ? shippingPlaceholders : [];
    const filled = fillPlaceholders(stripLeadingComments(body), values, keep).trim();
    const markers = findFillMarkers(filled);
    if (options.production && markers.length > 0) {
      throw new Error(`${name} still has blanks to fill before launch: ${markers.join(", ")}`);
    }
    return [
      slug,
      {
        slug,
        path: legalPaths[slug],
        title: meta.title,
        description: meta.description,
        updated: meta.updated,
        body: filled,
      },
    ];
  });
  return Object.fromEntries(entries) as Record<LegalSlug, LegalDocument>;
}
