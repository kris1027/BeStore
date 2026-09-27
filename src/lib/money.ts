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

export type ParseMoneyError = "format" | "decimals" | "too_large";

// Postgres `integer`, the type of every *_cents column.
const MAX_CENTS = 2_147_483_647;

// Major units typed by a person ("19.99") to integer minor units, by string arithmetic only,
// so no float ever rounds a price. The currency decides how many decimals are allowed.
export function parseMoney(
  text: string,
  currency: string,
):
  | { readonly ok: true; readonly cents: number }
  | { readonly ok: false; readonly error: ParseMoneyError } {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return { ok: false, error: "format" };
  const [, whole = "", fraction = ""] = match;

  const digits = fractionDigits(currency);
  if (fraction.length > digits) return { ok: false, error: "decimals" };

  const cents = Number(`${whole}${fraction.padEnd(digits, "0")}`);
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return { ok: false, error: "too_large" };
  return { ok: true, cents };
}

export function fractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}
