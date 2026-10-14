import type { EmailKind } from "@/generated/prisma/enums";

// How each email kind is named: `label` stands alone on the admin page (spec 0011, AC-13 and
// AC-14), `word` sits inside the system notes ("The <word> email could not be sent", AC-11).
export const emailKindNames: Readonly<
  Record<EmailKind, { readonly label: string; readonly word: string }>
> = {
  order_confirmation: { label: "Order confirmation", word: "confirmation" },
  order_shipped: { label: "Shipped", word: "shipped" },
  order_refunded: { label: "Refund", word: "refund" },
};
