import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { catalogTag, categoriesTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";

import { firstImageSelect, toImage } from "../queries";
import { buildIndexProduct } from "./index-rows";
import type { ListingProduct } from "./listing";

// spec 0013, AC-22: every listable product (active, with a non archived variant) read once into
// one cached list; search, filters and counts then run in memory (listing.ts). Tagged catalog
// for product writes and categories for membership and order.
export async function getListingIndex(): Promise<readonly ListingProduct[]> {
  "use cache";
  cacheLife("max");
  cacheTag(catalogTag, categoriesTag);

  const products = await db.product.findMany({
    where: { status: "active", variants: { some: { archived: false } } },
    select: {
      id: true,
      name: true,
      slug: true,
      position: true,
      createdAt: true,
      images: firstImageSelect,
      categories: { select: { categoryId: true, position: true } },
      optionTypes: {
        orderBy: { position: "asc" },
        select: {
          name: true,
          values: { orderBy: { position: "asc" }, select: { id: true, value: true } },
        },
      },
      variants: {
        where: { archived: false },
        orderBy: { position: "asc" },
        select: {
          priceCents: true,
          compareAtPriceCents: true,
          stockQuantity: true,
          optionValues: { select: { optionValueId: true } },
        },
      },
    },
  });
  return products.map((product) =>
    buildIndexProduct({ ...product, image: toImage(product.images[0]) }),
  );
}
