import type { PrismaClient } from "../src/generated/prisma/client";

// Demo catalog for local development. Every write is an upsert keyed by slug, SKU or a
// compound unique, so running the seed again changes nothing. No images: the storefront
// shows its empty image state until admin uploads exist (feature 9).

type OptionSpec = { readonly name: string; readonly values: readonly string[] };

type VariantSpec = {
  readonly sku: string;
  readonly options: readonly string[]; // one value per option type, in option type order
  readonly priceCents: number;
  readonly compareAtPriceCents?: number;
  readonly stockQuantity: number;
};

type ProductSpec = {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly featured: boolean;
  readonly weightGrams: number;
  readonly categorySlugs: readonly string[];
  readonly options: readonly OptionSpec[];
  readonly variants: readonly VariantSpec[];
};

const categories = [
  { slug: "clothing", name: "Clothing", position: 0 },
  { slug: "accessories", name: "Accessories", position: 1 },
] as const;

const teeColors = ["White", "Black"] as const;
const sizes = ["S", "M", "L"] as const;

const products: readonly ProductSpec[] = [
  {
    slug: "canvas-tote-bag",
    name: "Canvas Tote Bag",
    description: "A sturdy **cotton canvas** tote for everyday carry.",
    featured: true,
    weightGrams: 250,
    categorySlugs: ["accessories"],
    options: [],
    variants: [{ sku: "TOTE-NATURAL", options: [], priceCents: 1900, stockQuantity: 25 }],
  },
  {
    slug: "classic-hoodie",
    name: "Classic Hoodie",
    description: "Heavyweight fleece hoodie with a kangaroo pocket.",
    featured: false,
    weightGrams: 650,
    categorySlugs: ["clothing"],
    options: [{ name: "Size", values: sizes }],
    variants: sizes.map((size) => ({
      sku: `HOODIE-${size}`,
      options: [size],
      priceCents: 5900,
      stockQuantity: size === "L" ? 0 : 10,
    })),
  },
  {
    slug: "organic-tee",
    name: "Organic Tee",
    description: "Soft organic cotton tee.\n\n- Regular fit\n- Machine washable",
    featured: true,
    weightGrams: 180,
    categorySlugs: ["clothing"],
    options: [
      { name: "Size", values: sizes },
      { name: "Color", values: teeColors },
    ],
    variants: sizes.flatMap((size) =>
      teeColors.map((color) => ({
        sku: `TEE-${size}-${color.toUpperCase()}`,
        options: [size, color],
        priceCents: 2900,
        compareAtPriceCents: 3500,
        stockQuantity: size === "S" && color === "Black" ? 0 : 8,
      })),
    ),
  },
];

export async function seedDemoCatalog(db: PrismaClient): Promise<void> {
  const categoryIds = new Map<string, string>();
  for (const category of categories) {
    const row = await db.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    });
    categoryIds.set(category.slug, row.id);
  }

  for (const [position, spec] of products.entries()) {
    await db.$transaction(async (tx) => {
      const product = await tx.product.upsert({
        where: { slug: spec.slug },
        update: {},
        create: {
          slug: spec.slug,
          name: spec.name,
          description: spec.description,
          status: "active",
          featured: spec.featured,
          position,
          weightGrams: spec.weightGrams,
        },
      });

      for (const [categoryPosition, slug] of spec.categorySlugs.entries()) {
        const categoryId = categoryIds.get(slug);
        if (!categoryId) throw new Error(`Unknown category ${slug} in the demo catalog`);
        await tx.productCategory.upsert({
          where: { productId_categoryId: { productId: product.id, categoryId } },
          update: {},
          create: { productId: product.id, categoryId, position: categoryPosition },
        });
      }

      // Option value ids by option type index, then value.
      const valueIds: Map<string, string>[] = [];
      for (const [typePosition, option] of spec.options.entries()) {
        const type = await tx.productOptionType.upsert({
          where: { productId_name: { productId: product.id, name: option.name } },
          update: {},
          create: { productId: product.id, name: option.name, position: typePosition },
        });
        const ids = new Map<string, string>();
        for (const [valuePosition, value] of option.values.entries()) {
          const row = await tx.productOptionValue.upsert({
            where: { optionTypeId_value: { optionTypeId: type.id, value } },
            update: {},
            create: { optionTypeId: type.id, value, position: valuePosition },
          });
          ids.set(value, row.id);
        }
        valueIds.push(ids);
      }

      for (const [variantPosition, variant] of spec.variants.entries()) {
        const optionValueIds = variant.options.map((value, index) => {
          const id = valueIds[index]?.get(value);
          if (!id) throw new Error(`Unknown option value ${value} on ${variant.sku}`);
          return id;
        });
        const row = await tx.productVariant.upsert({
          where: { sku: variant.sku },
          update: {},
          create: {
            productId: product.id,
            sku: variant.sku,
            priceCents: variant.priceCents,
            compareAtPriceCents: variant.compareAtPriceCents,
            stockQuantity: variant.stockQuantity,
            position: variantPosition,
            optionKey: optionKeyOf(optionValueIds),
          },
        });
        await tx.variantOptionValue.createMany({
          data: optionValueIds.map((optionValueId) => ({ variantId: row.id, optionValueId })),
          skipDuplicates: true,
        });
      }
    });
  }
}

// Spec 0002: the variant's option value ids sorted ascending, joined with ","; "" for none.
function optionKeyOf(optionValueIds: readonly string[]): string {
  return optionValueIds.toSorted().join(",");
}
