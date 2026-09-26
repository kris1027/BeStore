import { lineCap } from "@/lib/availability";

// Pure cart rules (spec 0005, AC-11). A flag is computed at read time and never stored.

export type LineFacts = {
  readonly quantity: number;
  readonly priceCents: number;
  readonly stockQuantity: number;
  readonly variantArchived: boolean;
  readonly productActive: boolean;
};

export type LineFlag =
  | { readonly kind: "ok" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "sold_out" }
  | { readonly kind: "insufficient"; readonly left: number };

// First match wins: unavailable, sold out, then only N left.
export function lineFlag(line: LineFacts): LineFlag {
  if (line.variantArchived || !line.productActive) return { kind: "unavailable" };
  if (line.stockQuantity <= 0) return { kind: "sold_out" };
  if (line.quantity > line.stockQuantity)
    return { kind: "insufficient", left: lineCap(line.stockQuantity) };
  return { kind: "ok" };
}

export function lineTotal(line: Pick<LineFacts, "quantity" | "priceCents">): number {
  return line.priceCents * line.quantity;
}

export function cartSubtotal(lines: readonly Pick<LineFacts, "quantity" | "priceCents">[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

export function cartQuantity(lines: readonly Pick<LineFacts, "quantity">[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

// Checkout needs at least one line and no flagged line.
export function canCheckout(lines: readonly LineFacts[]): boolean {
  return lines.length > 0 && lines.every((line) => lineFlag(line).kind === "ok");
}
