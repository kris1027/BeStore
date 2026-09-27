import "server-only";

import { db } from "@/lib/db";
import { PLACEHOLDER_IMAGE, productImageUrl } from "@/lib/product-image";
import { variantLabel } from "@/lib/variant-label";

import {
  canCheckout,
  cartQuantity,
  cartSubtotal,
  type LineFacts,
  type LineFlag,
  lineFlag,
  lineTotal,
} from "./cart-lines";
import { readCartId } from "./cookie";

export type CartLine = LineFacts & {
  readonly id: string;
  readonly variantId: string;
  readonly productName: string;
  readonly productSlug: string;
  readonly variantLabel: string | null;
  readonly image: { readonly src: string; readonly alt: string };
  readonly flag: LineFlag;
  readonly totalCents: number;
};

export type Cart = {
  readonly id: string;
  readonly lines: readonly CartLine[];
  readonly quantity: number;
  readonly subtotalCents: number;
  readonly canCheckout: boolean;
};

// Loads a cart by id with live variant data, or null when it does not exist or has expired.
// Read only: rendering a cart never writes (spec 0005, AC-11).
export async function loadCartById(cartId: string, now: Date): Promise<Cart | null> {
  const cart = await db.cart.findFirst({
    where: { id: cartId, expiresAt: { gt: now } },
    select: {
      id: true,
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          quantity: true,
          variant: {
            select: {
              id: true,
              priceCents: true,
              stockQuantity: true,
              archived: true,
              optionValues: {
                select: {
                  optionValue: {
                    select: { value: true, optionType: { select: { position: true } } },
                  },
                },
              },
              product: {
                select: {
                  name: true,
                  slug: true,
                  status: true,
                  images: {
                    orderBy: { position: "asc" },
                    take: 1,
                    select: { storagePath: true, altText: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!cart) return null;

  const lines = cart.items.map(({ id, quantity, variant }): CartLine => {
    const facts: LineFacts = {
      quantity,
      priceCents: variant.priceCents,
      stockQuantity: variant.stockQuantity,
      variantArchived: variant.archived,
      productActive: variant.product.status === "active",
    };
    const image = variant.product.images[0];
    return {
      ...facts,
      id,
      variantId: variant.id,
      productName: variant.product.name,
      productSlug: variant.product.slug,
      variantLabel: variantLabel(
        variant.optionValues.map(({ optionValue }) => ({
          value: optionValue.value,
          typePosition: optionValue.optionType.position,
        })),
      ),
      // The product name sits beside the image, so the placeholder is decorative.
      image: image
        ? { src: productImageUrl(image.storagePath), alt: image.altText }
        : { src: PLACEHOLDER_IMAGE, alt: "" },
      flag: lineFlag(facts),
      totalCents: lineTotal(facts),
    };
  });

  return {
    id: cart.id,
    lines,
    quantity: cartQuantity(lines),
    subtotalCents: cartSubtotal(lines),
    canCheckout: canCheckout(lines),
  };
}

// The cart named by the visitor's cookie. A bad signature, an unknown or an expired cart all
// read as no cart, never as an error (AC-9).
export async function loadCart(): Promise<Cart | null> {
  const cartId = await readCartId();
  if (cartId === null) return null;
  return loadCartById(cartId, new Date());
}
