import { beforeEach, describe, expect, it, vi } from "vitest";

import { signCartId } from "@/lib/cart/signature";

import { addAuthUser, resetAuthStub } from "./auth-stub";
import { resetDatabaseBeforeEach, testDb } from "./client";
import { createCustomer, createOrder, createSimpleProduct, inThirtyDays } from "./fixtures";

// Account setup (spec 0012, AC-10) and the cart merge (AC-5) against a real Postgres.

const secret = "c".repeat(32);

const mocks = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: unknown }>(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { CART_COOKIE_SECRET: "c".repeat(32) } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: mocks.error },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = mocks.jar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options?: unknown) =>
      mocks.jar.set(name, { value, options }),
    delete: (name: string) => mocks.jar.delete(name),
  }),
}));

const { accountSetup, mergeCartForCustomer } = await import("@/lib/customer/setup");
const { lockCustomer } = await import("@/lib/customer/lock");
const { mergeCarts } = await import("@/lib/cart/merge");

resetDatabaseBeforeEach();

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.jar.clear();
  await resetAuthStub();
});

function setCookieCart(cartId: string) {
  mocks.jar.set("bestore_cart", { value: signCartId(cartId, secret) });
}

function cookieCartId(): string | undefined {
  return mocks.jar.get("bestore_cart")?.value.split(".")[0];
}

function identity(email = "ada@example.com") {
  return { id: crypto.randomUUID(), email };
}

async function cartWith(lines: { variantId: string; quantity: number }[], customerId?: string) {
  return testDb.cart.create({
    data: {
      customerId,
      expiresAt: inThirtyDays(),
      items: { create: lines },
    },
    include: { items: true },
  });
}

async function linesOf(cartId: string) {
  const items = await testDb.cartItem.findMany({
    where: { cartId },
    select: { variantId: true, quantity: true },
    orderBy: { createdAt: "asc" },
  });
  return items;
}

describe("accountSetup: the row and order linking (AC-10)", () => {
  it("creates the customers row and links every guest order with the email", async () => {
    const customer = identity();
    await addAuthUser(customer.id);
    const mine = await createOrder({ email: "ada@example.com", status: "paid" });
    const pending = await createOrder({ email: "ada@example.com" });
    const other = await createOrder({ email: "bob@example.com", status: "paid" });

    const outcome = await accountSetup(customer);

    expect(outcome).toMatchObject({ ok: true, linked: 2 });
    expect(await testDb.customer.findUnique({ where: { id: customer.id } })).toMatchObject({
      email: "ada@example.com",
    });
    const orders = await testDb.order.findMany({ select: { id: true, customerId: true } });
    const byId = new Map(orders.map((order) => [order.id, order.customerId]));
    expect(byId.get(mine.id)).toBe(customer.id);
    // Linked but still hidden from history until paid (AC-11).
    expect(byId.get(pending.id)).toBe(customer.id);
    expect(byId.get(other.id)).toBeNull();
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "account.orders_linked", customerId: customer.id, count: 2 },
      "account.orders_linked",
    );
  });

  it("never moves an order that belongs to another customer", async () => {
    const owner = await createCustomer("owner@example.com");
    const theirs = await createOrder({ email: "ada@example.com", customerId: owner.id });
    const customer = identity();

    await accountSetup(customer);

    expect((await testDb.order.findUnique({ where: { id: theirs.id } }))?.customerId).toBe(
      owner.id,
    );
  });

  it("is safe to run again: nothing changes the second time", async () => {
    const customer = identity();
    await createOrder({ email: "ada@example.com", status: "paid" });

    await accountSetup(customer);
    const again = await accountSetup(customer);

    expect(again).toMatchObject({ ok: true, linked: 0 });
    expect(await testDb.customer.count()).toBe(1);
  });

  it("removes a leftover row whose auth user is gone, then links its orders to the new account", async () => {
    const stale = await createCustomer("ada@example.com");
    const order = await createOrder({ email: "ada@example.com", customerId: stale.id });
    await testDb.customerAddress.create({
      data: {
        customerId: stale.id,
        fullName: "Ada",
        line1: "1 Main St",
        city: "Warsaw",
        postalCode: "00-001",
        countryCode: "PL",
      },
    });
    const customer = identity();
    await addAuthUser(customer.id);

    const outcome = await accountSetup(customer);

    expect(outcome).toMatchObject({ ok: true, linked: 1 });
    expect(await testDb.customer.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await testDb.customerAddress.count()).toBe(0);
    expect((await testDb.order.findUnique({ where: { id: order.id } }))?.customerId).toBe(
      customer.id,
    );
  });

  it("stops on a live account holding the email and logs the conflict", async () => {
    const live = await createCustomer("ada@example.com");
    await addAuthUser(live.id);
    const order = await createOrder({ email: "ada@example.com" });
    const customer = identity();

    const outcome = await accountSetup(customer);

    expect(outcome).toEqual({ ok: false, error: "email_conflict" });
    expect(await testDb.customer.findUnique({ where: { id: customer.id } })).toBeNull();
    expect((await testDb.order.findUnique({ where: { id: order.id } }))?.customerId).toBeNull();
    expect(mocks.error).toHaveBeenCalledWith(
      { event: "account.email_conflict", customerId: customer.id },
      "account.email_conflict",
    );
  });
});

describe("the cart merge (AC-5)", () => {
  it("gives the guest cart to a customer who has none", async () => {
    const { variant } = await createSimpleProduct("a", 8);
    const guest = await cartWith([{ variantId: variant.id, quantity: 2 }]);
    setCookieCart(guest.id);
    const customer = identity();

    await accountSetup(customer);

    expect((await testDb.cart.findUnique({ where: { id: guest.id } }))?.customerId).toBe(
      customer.id,
    );
    expect(cookieCartId()).toBe(guest.id);
  });

  it("points the cookie at the account cart when there is no guest cart", async () => {
    const customer = identity();
    await testDb.customer.create({ data: customer });
    const account = await cartWith([], customer.id);

    await accountSetup(customer);

    expect(cookieCartId()).toBe(account.id);
  });

  it("sums lines of one variant up to the cap, moves the rest, and deletes the guest cart", async () => {
    const { variant: shared } = await createSimpleProduct("shared", 7);
    const { variant: onlyGuest } = await createSimpleProduct("guest", 20);
    const { variant: onlyAccount } = await createSimpleProduct("acct", 20);
    const customer = identity();
    await testDb.customer.create({ data: customer });
    const account = await cartWith(
      [
        { variantId: shared.id, quantity: 5 },
        { variantId: onlyAccount.id, quantity: 1 },
      ],
      customer.id,
    );
    const guest = await cartWith([
      { variantId: shared.id, quantity: 4 },
      { variantId: onlyGuest.id, quantity: 3 },
    ]);
    const pendingOnGuest = await createOrder({ cartId: guest.id });
    setCookieCart(guest.id);

    const merge = await mergeCartForCustomer(customer.id);

    expect(merge).toMatchObject({ cartId: account.id, linesMoved: 2, accountHadLines: true });
    expect(await testDb.cart.findUnique({ where: { id: guest.id } })).toBeNull();
    const lines = new Map((await linesOf(account.id)).map((l) => [l.variantId, l.quantity]));
    // 5 + 4 capped at stock 7.
    expect(lines.get(shared.id)).toBe(7);
    expect(lines.get(onlyGuest.id)).toBe(3);
    expect(lines.get(onlyAccount.id)).toBe(1);
    expect(cookieCartId()).toBe(account.id);
    // A pending order on the deleted guest cart keeps its row.
    expect(
      (await testDb.order.findUnique({ where: { id: pendingOnGuest.id } }))?.cartId,
    ).toBeNull();
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "account.cart_merged", customerId: customer.id, lines: 2 },
      "account.cart_merged",
    );
  });

  it("caps a moved line at 10 and moves sold out or archived lines as they are", async () => {
    const { variant: plenty } = await createSimpleProduct("plenty", 50);
    const { variant: soldOut } = await createSimpleProduct("soldout", 0);
    const { variant: archived } = await createSimpleProduct("archived", 5);
    await testDb.productVariant.update({ where: { id: archived.id }, data: { archived: true } });
    const customer = identity();
    await testDb.customer.create({ data: customer });
    const account = await cartWith([{ variantId: soldOut.id, quantity: 1 }], customer.id);
    const guest = await cartWith([
      { variantId: plenty.id, quantity: 10 },
      { variantId: soldOut.id, quantity: 2 },
      { variantId: archived.id, quantity: 4 },
    ]);
    await testDb.cartItem.updateMany({
      where: { cartId: account.id, variantId: soldOut.id },
      data: { quantity: 1 },
    });
    setCookieCart(guest.id);

    await mergeCartForCustomer(customer.id);

    const lines = new Map((await linesOf(account.id)).map((l) => [l.variantId, l.quantity]));
    expect(lines.get(plenty.id)).toBe(10);
    // The account's sold out line stays as it was; the guest's archived line moves untouched.
    expect(lines.get(soldOut.id)).toBe(1);
    expect(lines.get(archived.id)).toBe(4);
  });

  it("ignores a cookie naming another customer's cart and drops it when there is nothing else", async () => {
    const { variant } = await createSimpleProduct("x", 5);
    const other = await createCustomer("other@example.com");
    const theirs = await cartWith([{ variantId: variant.id, quantity: 1 }], other.id);
    setCookieCart(theirs.id);
    const customer = identity();
    await testDb.customer.create({ data: customer });

    const merge = await mergeCartForCustomer(customer.id);

    expect(merge.cartId).toBeNull();
    expect(cookieCartId()).toBeUndefined();
    expect(await linesOf(theirs.id)).toHaveLength(1);
    expect((await testDb.cart.findUnique({ where: { id: theirs.id } }))?.customerId).toBe(other.id);
  });

  it("replaces an expired account cart with the guest one", async () => {
    const { variant } = await createSimpleProduct("x", 5);
    const customer = identity();
    await testDb.customer.create({ data: customer });
    const expired = await testDb.cart.create({
      data: { customerId: customer.id, expiresAt: new Date(Date.now() - 1000) },
    });
    const guest = await cartWith([{ variantId: variant.id, quantity: 1 }]);
    setCookieCart(guest.id);

    const merge = await mergeCartForCustomer(customer.id);

    expect(merge.cartId).toBe(guest.id);
    expect(await testDb.cart.findUnique({ where: { id: expired.id } })).toBeNull();
  });

  it("leaves one account cart when two sign ins of one account race", async () => {
    const { variant: a } = await createSimpleProduct("a", 10);
    const { variant: b } = await createSimpleProduct("b", 10);
    const customer = identity();
    const first = await cartWith([{ variantId: a.id, quantity: 1 }]);
    const second = await cartWith([{ variantId: b.id, quantity: 2 }]);

    await testDb.customer.create({ data: customer });

    // Two browsers, each with its own guest cookie, merging at once under the customer lock.
    const merge = (cookieCartId: string) =>
      testDb.$transaction(async (tx) => {
        await lockCustomer(tx, customer.id);
        return mergeCarts(tx, customer.id, cookieCartId, Date.now());
      });
    const results = await Promise.all([merge(first.id), merge(second.id)]);

    // The first one in made its guest cart the account cart; the second merged into it.
    expect(results[0]!.cartId).toBe(results[1]!.cartId);
    const carts = await testDb.cart.findMany({ where: { customerId: customer.id } });
    expect(carts).toHaveLength(1);
    const lines = await linesOf(carts[0]!.id);
    expect(lines).toHaveLength(2);
  });
});
