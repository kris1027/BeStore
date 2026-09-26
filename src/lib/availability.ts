// "Only N left" shows at this stock or below; above it the exact count never reaches the browser.
export const LOW_STOCK_THRESHOLD = 5;

// No cart line holds more than this, whatever the stock.
export const MAX_LINE_QUANTITY = 10;

export type Availability =
  | { readonly kind: "in_stock" }
  | { readonly kind: "low"; readonly left: number }
  | { readonly kind: "sold_out" };

export function availability(stock: number): Availability {
  if (stock <= 0) return { kind: "sold_out" };
  if (stock <= LOW_STOCK_THRESHOLD) return { kind: "low", left: stock };
  return { kind: "in_stock" };
}

// The most one cart line may hold for a variant with this stock; 0 means none at all.
export function lineCap(stock: number): number {
  return Math.max(0, Math.min(stock, MAX_LINE_QUANTITY));
}

// The most the quantity field offers. It never reveals a count above the low stock threshold,
// so it offers the full MAX_LINE_QUANTITY there; the server cap stays authoritative.
export function quantityLimit(state: Availability): number {
  if (state.kind === "sold_out") return 0;
  if (state.kind === "low") return Math.min(state.left, MAX_LINE_QUANTITY);
  return MAX_LINE_QUANTITY;
}
