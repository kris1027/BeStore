import { z } from "zod";

// Pure: the admin search box's `q` param, shared so every admin page that searches parses it
// the same way (products list, category "Add products").

export const SEARCH_MAX_LENGTH = 100;

// A repeated param (`?q=a&q=b`) arrives as an array; the first value wins.
export const firstValue = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

// Trimmed, up to SEARCH_MAX_LENGTH characters; anything missing or malformed is "" (no search),
// never an error.
export const searchQuerySchema = z
  .string()
  .optional()
  .catch(undefined)
  .transform((text) => text?.trim().slice(0, SEARCH_MAX_LENGTH) ?? "");

export function parseSearchQuery(params: Readonly<Record<string, unknown>>): string {
  return searchQuerySchema.parse(firstValue(params.q));
}
