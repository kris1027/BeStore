import { z } from "zod";

// Pure: the typed promo code and the one email normaliser (spec 0014, AC-1, AC-3 and AC-11).
// Every transform is safe to run twice: the checkout form sends its parsed output and the
// server parses it again.

export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9-]{3,32}$/;

// Longer text is never a code; cut before the format check so a pasted page is not echoed.
const CODE_TEXT_MAX_LENGTH = 64;

export const discountCodeTextSchema = z
  .string()
  .max(CODE_TEXT_MAX_LENGTH)
  .trim()
  .toUpperCase()
  .regex(DISCOUNT_CODE_PATTERN);

// What a customer typed, uppercased, or null when it can never be a code ("This code isn't
// valid." without a database read).
export function parseCodeText(text: unknown): string | null {
  const parsed = discountCodeTextSchema.safeParse(text);
  return parsed.success ? parsed.data : null;
}

// Per customer limits count by order email, so the redemption, the order and the checks all
// compare emails through this (AC-3). The checkout email schema uses it too.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
