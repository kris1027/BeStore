// spec 0008, AC-8 and AC-9: what an admin page shows for an order's email. The purge stamp is
// checked first, so a null email reads as removed only when the purge really ran; a null email
// without it breaks the CHECK on orders and must show as missing, never as an empty cell.
export type EmailDisplay =
  | { readonly kind: "email"; readonly email: string }
  | { readonly kind: "purged"; readonly purgedAt: Date }
  | { readonly kind: "missing" };

export function emailDisplay(order: {
  readonly email: string | null;
  readonly piiPurgedAt: Date | null;
}): EmailDisplay {
  if (order.piiPurgedAt !== null) return { kind: "purged", purgedAt: order.piiPurgedAt };
  if (order.email === null) return { kind: "missing" };
  return { kind: "email", email: order.email };
}
