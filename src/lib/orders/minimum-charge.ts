// Stripe's minimum charge per currency, in the minor units Stripe counts
// (https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts, checked 2026-09-27).
// Checked before an order row exists, so a too small cart never leaves a stray pending order;
// Stripe's own `amount_too_small` error maps to the same result as a backstop.
const minimums: Readonly<Record<string, number>> = {
  AED: 200,
  ARS: 50,
  AUD: 50,
  BRL: 50,
  CAD: 50,
  CHF: 50,
  COP: 50,
  CZK: 1500,
  DKK: 250,
  EUR: 50,
  GBP: 30,
  HKD: 400,
  HUF: 17500,
  IDR: 50,
  ILS: 50,
  INR: 50,
  JPY: 50,
  KRW: 50,
  MXN: 1000,
  MYR: 200,
  NOK: 300,
  NZD: 50,
  PHP: 50,
  PLN: 200,
  RON: 200,
  RUB: 50,
  SEK: 300,
  SGD: 50,
  THB: 1000,
  USD: 50,
  ZAR: 50,
};

const fallbackMinimum = 50;

export function minimumChargeCents(currency: string): number {
  return minimums[currency.toUpperCase()] ?? fallbackMinimum;
}
