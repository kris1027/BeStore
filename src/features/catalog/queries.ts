import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { type Availability, availability } from "@/lib/availability";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { PLACEHOLDER_IMAGE, productImageUrl } from "@/lib/product-image";
import { SLUG_PATTERN } from "@/lib/slug";

// How many product pages the build prerenders; the rest render on their first visit.
const PRERENDERED_PRODUCTS = 48;

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

// The card image: the first by position.
export const firstImageSelect = {
  orderBy: { position: "asc" },
  take: 1,
  select: { storagePath: true, altText: true, width: true, height: true },
} as const;

export function toImage(
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

// A listing card (spec 0013 builds them from the listing index).
export type ProductCard = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly image: ProductImage;
  readonly minPriceCents: number;
  readonly maxPriceCents: number;
  readonly soldOut: boolean;
  // spec 0009, AC-16: a variant in stock has a compare at price.
  readonly onSale: boolean;
};

// What the product page and its picker get: an availability per variant, never the stock
// count itself, so counts above the low stock threshold never reach the browser (AC-7).
export type ProductVariantView = {
  readonly id: string;
  // In the Product JSON-LD (spec 0018, AC-8); not sensitive, order lines show it too.
  readonly sku: string;
  readonly priceCents: number;
  // Shown struck through as "Was"; never charged (AC-16).
  readonly compareAtPriceCents: number | null;
  readonly availability: Availability;
  // One option value id per option type, in option type order; empty for a default variant.
  readonly optionValueIds: readonly string[];
};

export type ProductOptionTypeView = {
  readonly id: string;
  readonly name: string;
  readonly values: readonly { readonly id: string; readonly value: string }[];
};

// Every image of the product page; the gallery picks per variant (spec 0009, AC-15).
export type GalleryImage = ProductImage & {
  readonly id: string;
  readonly position: number;
  readonly optionValueId: string | null;
};

export type ProductView = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  // Markdown, rendered by ProductDescription (spec 0009, AC-6).
  readonly description: string;
  // Set only in the database for now; blank or null falls back to the name and description.
  readonly metaTitle: string | null;
  readonly metaDescription: string | null;
  readonly images: readonly GalleryImage[];
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
      metaTitle: true,
      metaDescription: true,
      images: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          storagePath: true,
          altText: true,
          width: true,
          height: true,
          position: true,
          optionValueId: true,
        },
      },
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
          sku: true,
          priceCents: true,
          compareAtPriceCents: true,
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
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    images: product.images.map((image) => ({
      ...toImage(image),
      id: image.id,
      position: image.position,
      optionValueId: image.optionValueId,
    })),
    optionTypes: product.optionTypes,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      priceCents: variant.priceCents,
      compareAtPriceCents: variant.compareAtPriceCents,
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
    take: PRERENDERED_PRODUCTS,
    select: { slug: true },
  });
  return products.map((product) => product.slug);
}

export type SitemapProduct = {
  readonly slug: string;
  // ISO 8601: a cached value must survive serialization as it is.
  readonly updatedAt: string;
  readonly imageUrls: readonly string[];
};

// spec 0018, AC-18 and AC-19: every product the storefront lists (active, with a live variant),
// tagged catalog so a product write shows in the sitemap on the next request.
export async function getSitemapProducts(): Promise<readonly SitemapProduct[]> {
  "use cache";
  cacheLife("max");
  cacheTag(catalogTag);

  const products = await db.product.findMany({
    where: { status: "active", variants: { some: { archived: false } } },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    select: {
      slug: true,
      updatedAt: true,
      images: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { storagePath: true },
      },
    },
  });
  return products.map((product) => ({
    slug: product.slug,
    updatedAt: product.updatedAt.toISOString(),
    imageUrls: product.images.map((image) => productImageUrl(image.storagePath)),
  }));
}
