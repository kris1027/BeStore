export type MoneyFormat = {
  readonly currency: string;
  readonly locale: string;
};

// The only place minor units become a display string. The divisor comes from the currency's
// own fraction digits (EUR 2, JPY 0), so nothing divides cents by 100 by hand.
export function formatMoney(cents: number, { currency, locale }: MoneyFormat): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatMoney expects integer minor units, got ${cents}`);
  }
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(cents / 10 ** digits);
}
