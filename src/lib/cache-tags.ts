// The cache tags of the storefront catalog (spec 0005). Whatever changes what a tagged read
// returns must expire the tag: updateTag() in a server action, revalidateTag(tag, { expire: 0 })
// in a route handler (the Stripe webhook when stock changes).
export const catalogTag = "catalog";

export function productTag(slug: string): string {
  return `product:${slug}`;
}

// The one store_settings row (spec 0007): the delivery fee and free delivery threshold the cart
// and checkout show. Pay never reads it through the cache.
export const storeSettingsTag = "store-settings";
