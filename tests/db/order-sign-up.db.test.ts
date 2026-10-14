import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createCustomer, createOrder } from "./fixtures";

// spec 0012, AC-17: when the confirmation page offers an account, and signUpFromOrder's check.

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  after: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  }),
}));
vi.mock("@/features/account/sign-up-email", () => ({ sendSignUp: mocks.signUp }));

const { orderSignUpEmail } = await import("@/features/account/order-sign-up");
const { signUpFromOrder } = await import("@/features/account/actions/sign-up-from-order");

resetDatabaseBeforeEach();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
});

let counter = 0;

async function orderWithSession(
  overrides: Parameters<typeof createOrder>[0] = {},
): Promise<string> {
  counter += 1;
  const sessionId = `cs_test_offer${counter}`;
  const order = await createOrder({ email: "guest@example.com", status: "paid", ...overrides });
  await testDb.order.update({
    where: { id: order.id },
    data: { stripeCheckoutSessionId: sessionId },
  });
  return sessionId;
}

describe("orderSignUpEmail", () => {
  it.each(["paid", "shipped", "delivered"] as const)(
    "offers an account for a %s guest order to a visitor with no session",
    async (status) => {
      const sessionId = await orderWithSession({ status });

      expect(await orderSignUpEmail(sessionId)).toBe("guest@example.com");
    },
  );

  it("never offers for a pending, cancelled or expired order", async () => {
    for (const status of ["pending_payment", "cancelled", "expired"] as const) {
      expect(await orderSignUpEmail(await orderWithSession({ status }))).toBeNull();
    }
  });

  it("never offers for an order an account already holds, or to a signed in visitor", async () => {
    const customer = await createCustomer();
    expect(await orderSignUpEmail(await orderWithSession({ customerId: customer.id }))).toBeNull();

    const sessionId = await orderWithSession();
    mocks.user = { id: customer.id };
    expect(await orderSignUpEmail(sessionId)).toBeNull();
  });

  it("refuses anything that is not a Checkout Session id, or an unknown one", async () => {
    for (const value of [undefined, "", "pi_123", "cs_test_unknown"]) {
      expect(await orderSignUpEmail(value)).toBeNull();
    }
  });
});

describe("signUpFromOrder", () => {
  it("signs up the order's email after answering", async () => {
    const sessionId = await orderWithSession();

    expect(await signUpFromOrder(sessionId)).toEqual({ ok: true, data: null });
    expect(mocks.signUp).not.toHaveBeenCalled();
    for (const [task] of mocks.after.mock.calls) await (task as () => Promise<void>)();
    expect(mocks.signUp).toHaveBeenCalledWith("guest@example.com");
  });

  it("answers not_eligible and signs up no one otherwise", async () => {
    const sessionId = await orderWithSession({ status: "pending_payment" });

    expect(await signUpFromOrder(sessionId)).toEqual({ ok: false, error: "not_eligible" });
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
