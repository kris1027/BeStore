import { describe, expect, it } from "vitest";

import { availability } from "@/lib/availability";

import type { ProductView, ProductVariantView } from "./queries";
import { productJsonLd, productSeo, type StoreFacts } from "./seo";

const store: StoreFacts = {
  url: "https://shop.example",
  name: "BeStore",
  locale: "en",
  currency: "EUR",
  country: "PL",
};

function variant(overrides: Partial<ProductVariantView> = {}): ProductVariantView {
  return {
    id: "v1",
    sku: "SCARF-RED",
    priceCents: 12900,
    compareAtPriceCents: null,
    availability: availability(20),
    optionValueIds: [],
    ...overrides,
  };
}

function product(overrides: Partial<ProductView> = {}): ProductView {
  return {
    id: "p1",
    name: "Wool scarf",
    slug: "wool-scarf",
    description: "A **warm** scarf.",
    metaTitle: null,
    metaDescription: null,
    images: [
      {
        id: "i1",
        src: "https://cdn.example/1.jpg",
        alt: "",
        width: 800,
        height: 1000,
        position: 0,
        optionValueId: null,
      },
      {
        id: "i2",
        src: "https://cdn.example/2.jpg",
        alt: "Red",
        width: null,
        height: null,
        position: 1,
        optionValueId: "red",
      },
    ],
    optionTypes: [],
    variants: [variant()],
    ...overrides,
  };
}

const settings = { flatShippingCents: 999, freeShippingThresholdCents: 10000 };

// spec 0018, AC-5 and AC-6.
describe("productSeo", () => {
  it("falls back to the name, the description's plain text and the first image", () => {
    expect(productSeo(product())).toEqual({
      title: "Wool scarf",
      description: "A warm scarf.",
      path: "/products/wool-scarf",
      image: { url: "https://cdn.example/1.jpg", alt: "Wool scarf", width: 800, height: 1000 },
    });
  });

  it("prefers the meta fields", () => {
    expect(
      productSeo(product({ metaTitle: "Scarf | warm", metaDescription: "Buy it" })),
    ).toMatchObject({ title: "Scarf | warm", description: "Buy it" });
  });

  it("has no description for an empty one and no image without photos", () => {
    const seo = productSeo(product({ description: "", images: [] }));

    expect(seo.description).toBeNull();
    expect(seo).not.toHaveProperty("image");
  });

  it("uses the image alt text and leaves out an unknown size", () => {
    const [, second] = product().images;
    const seo = productSeo(product({ images: second ? [second] : [] }));

    expect(seo.image).toEqual({ url: "https://cdn.example/2.jpg", alt: "Red" });
  });
});

// spec 0018, AC-7 to AC-10.
describe("productJsonLd", () => {
  const twoVariants = product({
    variants: [
      variant({ sku: "A", priceCents: 12900, compareAtPriceCents: 15900 }),
      variant({ id: "v2", sku: "B", priceCents: 5000, availability: availability(0) }),
    ],
  });
  const data = productJsonLd(twoVariants, settings, store);

  it("describes the product with every gallery image and the brand", () => {
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Wool scarf",
      description: "A warm scarf.",
      url: "https://shop.example/products/wool-scarf",
      image: ["https://cdn.example/1.jpg", "https://cdn.example/2.jpg"],
      brand: { "@type": "Brand", name: "BeStore" },
    });
  });

  it("has one Offer per variant, in order, with prices in major units", () => {
    expect(data.offers).toEqual([
      {
        "@type": "Offer",
        sku: "A",
        price: "129.00",
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
        url: "https://shop.example/products/wool-scarf",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          priceType: "https://schema.org/StrikethroughPrice",
          price: "159.00",
          priceCurrency: "EUR",
        },
        shippingDetails: {
          "@type": "OfferShippingDetails",
          shippingDestination: { "@type": "DefinedRegion", addressCountry: "PL" },
          shippingRate: { "@type": "MonetaryAmount", value: 0, currency: "EUR" },
        },
      },
      {
        "@type": "Offer",
        sku: "B",
        price: "50.00",
        priceCurrency: "EUR",
        availability: "https://schema.org/OutOfStock",
        itemCondition: "https://schema.org/NewCondition",
        url: "https://shop.example/products/wool-scarf",
        shippingDetails: {
          "@type": "OfferShippingDetails",
          shippingDestination: { "@type": "DefinedRegion", addressCountry: "PL" },
          shippingRate: { "@type": "MonetaryAmount", value: 9.99, currency: "EUR" },
        },
      },
    ]);
  });

  it("counts low stock as in stock and never carries a count", () => {
    const low = productJsonLd(
      product({ variants: [variant({ availability: availability(2) })] }),
      settings,
      store,
    );

    expect(JSON.stringify(low)).toContain("https://schema.org/InStock");
    expect(JSON.stringify(low)).not.toMatch(/"left"|stock_?quantity|inventoryLevel/i);
  });

  it.each([
    ["at", 12900],
    ["below", 10000],
  ])("adds no strikethrough for a compare at price %s the price", (_label, compareAt) => {
    const offers = productJsonLd(
      product({ variants: [variant({ compareAtPriceCents: compareAt })] }),
      settings,
      store,
    ).offers;

    expect(JSON.stringify(offers)).not.toContain("priceSpecification");
  });

  function rate(priceCents: number, threshold: number | null) {
    const json = productJsonLd(
      product({ variants: [variant({ priceCents })] }),
      { flatShippingCents: 999, freeShippingThresholdCents: threshold },
      store,
    );
    return JSON.parse(JSON.stringify(json)).offers[0].shippingDetails.shippingRate.value;
  }

  it("charges the flat fee under the threshold and nothing at or above it", () => {
    expect(rate(9999, 10000)).toBe(9.99);
    expect(rate(10000, 10000)).toBe(0);
    expect(rate(10001, 10000)).toBe(0);
  });

  it("always charges the flat fee with no threshold", () => {
    expect(rate(1_000_000, null)).toBe(9.99);
  });

  it("formats prices with the currency's own fraction digits", () => {
    const yen = productJsonLd(product(), settings, { ...store, currency: "JPY" });

    expect(JSON.parse(JSON.stringify(yen)).offers[0].price).toBe("12900");
  });

  it("leaves out the image and description when there are none", () => {
    const bare = productJsonLd(product({ images: [], description: "" }), settings, store);

    expect(bare).not.toHaveProperty("image");
    expect(bare).not.toHaveProperty("description");
  });
});
