import type { MetadataRoute } from "next";

import { homePath, productPath } from "@/features/catalog/paths";
import { getSitemapProducts } from "@/features/catalog/queries";
import { categoryPath } from "@/features/categories/paths";
import { getSitemapCategories } from "@/features/categories/queries";
import { legalDocuments } from "@/lib/legal/documents";
import { legalSlugs } from "@/lib/legal/paths";
import { absoluteUrl } from "@/lib/seo/metadata";
import { site } from "@/lib/seo/site";

// spec 0018, AC-18 and AC-19: every public page and nothing else. Both reads are cached and
// tagged, so a product or category write shows here on the next request, with no deploy.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([getSitemapProducts(), getSitemapCategories()]);
  return [
    { url: absoluteUrl(homePath, site) },
    ...legalSlugs.map((slug) => ({
      url: absoluteUrl(legalDocuments[slug].path, site),
      lastModified: legalDocuments[slug].updated,
    })),
    ...categories.map((category) => ({
      url: absoluteUrl(categoryPath(category.slug), site),
      lastModified: category.updatedAt,
    })),
    ...products.map((product) => ({
      url: absoluteUrl(productPath(product.slug), site),
      lastModified: product.updatedAt,
      ...(product.imageUrls.length > 0 ? { images: [...product.imageUrls] } : {}),
    })),
  ];
}
