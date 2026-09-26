import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { type Availability, availability } from "@/lib/availability";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { PLACEHOLDER_IMAGE, productImageUrl } from "@/lib/product-image";
import { SLUG_PATTERN } from "@/lib/slug";

import { summarizeVariants } from "./product-summary";

// The home grid stops here until feature 13 adds paging (spec 0005, AC-6).
export const HOME_PRODUCT_LIMIT = 48;

export type ProductImage = {
  readonly src: string;
  readonly alt: string;
  readonly width: number | null;
  readonly height: number | null;
};

const placeholderImage: ProductImage = {
  src: PLACEHOLDER_IMAGE,
  alt: "",
  width: null,
  height: null,
};

const imageSelect = {
  orderBy: { position: "asc" },
  take: 1,
  select: { storagePath: true, altText: true, width: true, height: true },
} as const;

function toImage(
  row:
    | { storagePath: string; altText: string; width: number | null; height: number | null }
    | undefined,
): ProductImage {
  if (!row) return placeholderImage;
  return {
    src: productImageUrl(row.storagePath),
    alt: row.altText,
    width: row.width,
    height: row.height,
  };
}

export type ProductCard = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly image: ProductImage;
  readonly minPriceCents: number;
  readonly maxPriceCents: number;
  readonly soldOut: boolean;
};

// Cached until an admin action expires the catalog tag; drafts never enter it (spec 0005).
export async function getActiveProducts(): Promise<readonly ProductCard[]> {
  "use cache";
  cacheLife("max");
  cacheTag(catalogTag);

  const products = await db.product.findMany({
    where: { status: "active" },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    take: HOME_PRODUCT_LIMIT,
    select: {
      id: true,
      name: true,
      slug: true,
      images: imageSelect,
      variants: { where: { archived: false }, select: { priceCents: true, stockQuantity: true } },
    },
  });
  return products.map((product) => {
    const summary = summarizeVariants(product.variants);
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      image: toImage(product.images[0]),
      minPriceCents: summary.minPriceCents,
      maxPriceCents: summary.maxPriceCents,
      soldOut: summary.soldOut,
    };
  });
}

// What the product page and its picker get: an availability per variant, never the stock
// count itself, so counts above the low stock threshold never reach the browser (AC-7).
export type ProductVariantView = {
  readonly id: string;
  readonly priceCents: number;
  readonly availability: Availability;
  // One option value id per option type, in option type order; empty for a default variant.
  readonly optionValueIds: readonly string[];
};

export type ProductOptionTypeView = {
  readonly id: string;
  readonly name: string;
  readonly values: readonly { readonly id: string; readonly value: string }[];
};

export type ProductView = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly image: ProductImage;
  readonly optionTypes: readonly ProductOptionTypeView[];
  readonly variants: readonly ProductVariantView[];
};

export async function getProductBySlug(slug: string): Promise<ProductView | null> {
  "use cache";
  cacheLife("max");
  // Tagged even when nothing is found, so a cached 404 clears when that slug is created.
  cacheTag(productTag(slug));
  if (!SLUG_PATTERN.test(slug)) return null;

  const product = await db.product.findFirst({
    where: { slug, status: "active" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      images: imageSelect,
      optionTypes: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          values: { orderBy: { position: "asc" }, select: { id: true, value: true } },
        },
      },
      variants: {
        where: { archived: false },
        orderBy: { position: "asc" },
        select: {
          id: true,
          priceCents: true,
          stockQuantity: true,
          optionValues: { select: { optionValueId: true } },
        },
      },
    },
  });
  if (!product || product.variants.length === 0) return null;

  // Each variant's values in option type order, found through the type that owns each value.
  const typeOfValue = new Map(
    product.optionTypes.flatMap((type, t) => type.values.map((value) => [value.id, t] as const)),
  );
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    image: toImage(product.images[0]),
    optionTypes: product.optionTypes,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      priceCents: variant.priceCents,
      availability: availability(variant.stockQuantity),
      optionValueIds: variant.optionValues
        .map((link) => link.optionValueId)
        .sort((a, b) => (typeOfValue.get(a) ?? 0) - (typeOfValue.get(b) ?? 0)),
    })),
  };
}

// Prerendered at build: the newest active products (spec 0005, Caching model).
export async function getPrerenderedSlugs(): Promise<readonly string[]> {
  const products = await db.product.findMany({
    where: { status: "active" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HOME_PRODUCT_LIMIT,
    select: { slug: true },
  });
  return products.map((product) => product.slug);
}
