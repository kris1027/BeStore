import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin order page links to Stripe's dashboard (spec 0006, Value sourcing): a test key must
// land on the test dashboard, a live key on the live one, or an admin opens the wrong payment.

const env = vi.hoisted(() => ({ STRIPE_SECRET_KEY: "sk_test_abc" }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env }));
vi.mock("stripe", () => ({ default: class {} }));

const { stripeDashboardUrl } = await import("./stripe");

beforeEach(() => {
  env.STRIPE_SECRET_KEY = "sk_test_abc";
});

describe("stripeDashboardUrl", () => {
  it.each(["sk_test_abc", "rk_test_abc"])("opens the test dashboard for a %s key", (key) => {
    env.STRIPE_SECRET_KEY = key;

    expect(stripeDashboardUrl({ paymentIntentId: "pi_1" })).toBe(
      "https://dashboard.stripe.com/test/payments/pi_1",
    );
    expect(stripeDashboardUrl({ sessionId: "cs_test_1" })).toBe(
      "https://dashboard.stripe.com/test/checkout/sessions/cs_test_1",
    );
  });

  it.each(["sk_live_abc", "rk_live_abc"])("opens the live dashboard for a %s key", (key) => {
    env.STRIPE_SECRET_KEY = key;

    expect(stripeDashboardUrl({ paymentIntentId: "pi_1" })).toBe(
      "https://dashboard.stripe.com/payments/pi_1",
    );
    expect(stripeDashboardUrl({ sessionId: "cs_live_1" })).toBe(
      "https://dashboard.stripe.com/checkout/sessions/cs_live_1",
    );
  });

  it("does not mistake a live key that merely contains _test_ for a test key", () => {
    env.STRIPE_SECRET_KEY = "sk_live_has_test_inside";

    expect(stripeDashboardUrl({ paymentIntentId: "pi_1" })).toBe(
      "https://dashboard.stripe.com/payments/pi_1",
    );
  });
});
