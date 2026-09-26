import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createSimpleProduct } from "./fixtures";

// spec 0005, AC-16 and AC-18: the daily cleanup of abandoned carts.

const secret = "s".repeat(32);

const mocks = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: vi.fn() } }));

const { EXPIRED_CART_BATCH, expiredCartsRequest } = await import("@/features/cart/expired-carts");

resetDatabaseBeforeEach();

beforeEach(() => vi.clearAllMocks());

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/expired-carts", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

async function seedCarts(count: number, expiresAt: Date) {
  await testDb.cart.createMany({ data: Array.from({ length: count }, () => ({ expiresAt })) });
}

const past = () => new Date(Date.now() - 60_000);
const future = () => new Date(Date.now() + 86_400_000);

describe("GET /api/cron/expired-carts", () => {
  it.each([
    ["no header", undefined],
    ["a wrong secret", `Bearer ${"x".repeat(32)}`],
    ["the secret without Bearer", secret],
  ])("answers %s with 401 and deletes nothing", async (_, header) => {
    await seedCarts(2, past());

    const response = await expiredCartsRequest(request(header));

    expect(response.status).toBe(401);
    expect(await testDb.cart.count()).toBe(2);
  });

  it("deletes only expired carts, with their lines, and logs the count", async () => {
    await seedCarts(3, past());
    await seedCarts(2, future());
    const { variant } = await createSimpleProduct("a", 5);
    const expired = await testDb.cart.create({
      data: { expiresAt: past(), items: { create: { variantId: variant.id, quantity: 1 } } },
    });

    const response = await expiredCartsRequest(request(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 4 });
    expect(await testDb.cart.count()).toBe(2);
    expect(await testDb.cartItem.count({ where: { cartId: expired.id } })).toBe(0);
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "cron.expired_carts", deleted: 4 },
      "cron.expired_carts",
    );
  });

  it("works through more than one batch", async () => {
    await seedCarts(EXPIRED_CART_BATCH + 5, past());

    const response = await expiredCartsRequest(request(`Bearer ${secret}`));

    expect(await response.json()).toEqual({ deleted: EXPIRED_CART_BATCH + 5 });
    expect(await testDb.cart.count()).toBe(0);
  });
});
