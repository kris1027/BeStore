import type { ItemAvailability, Offer, Product, WithContext } from "schema-dts";

import type { Availability } from "@/lib/availability";
import { centsToInput } from "@/lib/money";
import { absoluteUrl, type PageSeo, type StoreFacts } from "@/lib/seo/metadata";
import { META_DESCRIPTION_MAX, plainExcerpt, presentText } from "@/lib/seo/text";
import { type ShippingSettings, shippingCents } from "@/lib/shipping/rule";

import { productPath } from "./paths";
import type { ProductView } from "./queries";

// Pure: a product page's metadata and its Product JSON-LD (spec 0018, AC-5 to AC-10). The data
// only ever describes what the page shows: the same live variants and prices, never a count.

// Google reads at most this much of a Product description.
const JSON_LD_DESCRIPTION_MAX = 5000;

// AC-5: meta fields first, then the name and the description's plain text; the first gallery
// image as the share image, or the brand card when there is none.
export function productSeo(product: ProductView): PageSeo {
  const image = product.images[0];
  return {
    title: presentText(product.metaTitle) ?? product.name,
    description:
      presentText(product.metaDescription) ??
      plainExcerpt(product.description, META_DESCRIPTION_MAX),
    path: productPath(product.slug),
    ...(image
      ? {
          image: {
            url: image.src,
            alt: presentText(image.alt) ?? product.name,
            ...(image.width !== null && image.height !== null
              ? { width: image.width, height: image.height }
              : {}),
          },
        }
      : {}),
  };
}

// AC-8: low stock is still in stock (LimitedAvailability means a limited run, not "few left").
function offerAvailability(state: Availability): ItemAvailability {
  return state.kind === "sold_out" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock";
}

export function productJsonLd(
  product: ProductView,
  settings: ShippingSettings,
  store: StoreFacts,
): WithContext<Product> {
  const url = absoluteUrl(productPath(product.slug), store);
  const description = plainExcerpt(product.description, JSON_LD_DESCRIPTION_MAX);
  const price = (cents: number) => centsToInput(cents, store.currency);

  const offers: Offer[] = product.variants.map((variant) => ({
    "@type": "Offer",
    sku: variant.sku,
    price: price(variant.priceCents),
    priceCurrency: store.currency,
    availability: offerAvailability(variant.availability),
    itemCondition: "https://schema.org/NewCondition",
    url,
    // AC-9: only a "Was" the page shows, so never one at or below the price.
    ...(variant.compareAtPriceCents !== null && variant.compareAtPriceCents > variant.priceCents
      ? {
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            priceType: "https://schema.org/StrikethroughPrice",
            price: price(variant.compareAtPriceCents),
            priceCurrency: store.currency,
          },
        }
      : {}),
    // AC-10: the fee of a one item order of this variant, by the rule the cart uses.
    shippingDetails: {
      "@type": "OfferShippingDetails",
      shippingDestination: { "@type": "DefinedRegion", addressCountry: store.country },
      shippingRate: {
        "@type": "MonetaryAmount",
        value: Number(
          price(shippingCents({ subtotalCents: variant.priceCents, discountCents: 0 }, settings)),
        ),
        currency: store.currency,
      },
    },
  }));

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    ...(description === null ? {} : { description }),
    url,
    ...(product.images.length > 0 ? { image: product.images.map((image) => image.src) } : {}),
    brand: { "@type": "Brand", name: store.name },
    offers,
  };
}
