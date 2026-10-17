import { Badge } from "@/components/ui/badge";
import {
  type CodeStatus,
  codeStatusLabels,
  discountLabel,
  type DiscountTerms,
} from "@/lib/discounts/rule";
import type { MoneyFormat } from "@/lib/money";

// spec 0014, AC-10: the status, discount and uses cells, shared by the list and the edit page.

export function CodeStatusBadge({ status }: { readonly status: CodeStatus }) {
  const variant = status === "active" ? "secondary" : "outline";
  return <Badge variant={variant}>{codeStatusLabels[status]}</Badge>;
}

export function DiscountTermsLabel({
  terms,
  money,
}: {
  readonly terms: DiscountTerms;
  readonly money: MoneyFormat;
}) {
  return <>{discountLabel(terms, money)}</>;
}

// "12 / 100", or "12" without a limit.
export function UsesLabel({ uses, max }: { readonly uses: number; readonly max: number | null }) {
  return <>{max === null ? uses : `${uses} / ${max}`}</>;
}
