import { z } from "zod";

import { firstValue, searchQuerySchema } from "@/lib/admin-search";
import type { CodeStatus } from "@/lib/discounts/rule";

// Pure: the /admin/discounts search and status filter as they live in the URL (spec 0014,
// AC-10). A bad value is ignored, never an error, like the other admin lists.

export const codeStatusFilters = [
  "active",
  "scheduled",
  "expired",
  "used_up",
  "inactive",
] as const satisfies readonly CodeStatus[];

export type DiscountListParams = {
  readonly q: string;
  readonly status: CodeStatus | null;
};

const statusSchema = z.enum(codeStatusFilters).optional().catch(undefined);

export function parseDiscountListParams(
  params: Readonly<Record<string, unknown>>,
): DiscountListParams {
  return {
    q: searchQuerySchema.parse(firstValue(params.q)),
    status: statusSchema.parse(firstValue(params.status)) ?? null,
  };
}

export function hasDiscountFilters(params: DiscountListParams): boolean {
  return params.q !== "" || params.status !== null;
}
