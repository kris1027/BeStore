import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { categoriesTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { SLUG_PATTERN } from "@/lib/slug";

// Cached storefront reads (spec 0013, AC-22): only visible categories, tagged `categories`, so
// every category write shows on the next request.

export type NavCategory = { readonly name: string; readonly slug: string };

// AC-3: the header nav, in admin order.
export async function getNavCategories(): Promise<readonly NavCategory[]> {
  "use cache";
  cacheLife("max");
  cacheTag(categoriesTag);

  return db.category.findMany({
    where: { visible: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { name: true, slug: true },
  });
}

export type StoreCategory = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly metaTitle: string | null;
  readonly metaDescription: string | null;
};

// AC-2: null for an unknown, malformed or hidden slug.
export async function getCategoryBySlug(slug: string): Promise<StoreCategory | null> {
  "use cache";
  cacheLife("max");
  cacheTag(categoriesTag);
  if (!SLUG_PATTERN.test(slug)) return null;

  return db.category.findFirst({
    where: { slug, visible: true },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      metaTitle: true,
      metaDescription: true,
    },
  });
}

// Prerendered at build: every visible category (there are few).
export async function getPrerenderedCategorySlugs(): Promise<readonly string[]> {
  const categories = await db.category.findMany({
    where: { visible: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { slug: true },
  });
  return categories.map((category) => category.slug);
}

export type SitemapCategory = {
  readonly slug: string;
  // ISO 8601: a cached value must survive serialization as it is.
  readonly updatedAt: string;
};

// spec 0018, AC-18 and AC-19: every visible category, for the sitemap.
export async function getSitemapCategories(): Promise<readonly SitemapCategory[]> {
  "use cache";
  cacheLife("max");
  cacheTag(categoriesTag);

  const categories = await db.category.findMany({
    where: { visible: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { slug: true, updatedAt: true },
  });
  return categories.map((category) => ({
    slug: category.slug,
    updatedAt: category.updatedAt.toISOString(),
  }));
}
