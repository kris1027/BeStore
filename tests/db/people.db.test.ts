import { describe, expect, it } from "vitest";

import { expectViolation, SQLSTATE, testDb, resetDatabaseBeforeEach } from "./client";
import { address, createCustomer, createSimpleProduct, inThirtyDays } from "./fixtures";

resetDatabaseBeforeEach();

describe("people", () => {
  it("rejects a duplicate customer or admin email", async () => {
    await createCustomer("ada@example.com");
    await testDb.adminUser.create({
      data: { id: crypto.randomUUID(), email: "admin@example.com", name: "Admin" },
    });

    await expectViolation(
      createCustomer("ada@example.com"),
      SQLSTATE.unique,
      "customers_email_key",
    );
    await expectViolation(
      testDb.adminUser.create({
        data: { id: crypto.randomUUID(), email: "admin@example.com", name: "Other" },
      }),
      SQLSTATE.unique,
      "admin_users_email_key",
    );
  });

  it("allows one auth user to hold both an admin and a customer row", async () => {
    const id = crypto.randomUUID();
    await testDb.adminUser.create({ data: { id, email: "both@example.com", name: "Both" } });

    await expect(
      testDb.customer.create({ data: { id, email: "both@example.com" } }),
    ).resolves.toBeDefined();
  });
});

describe("customer addresses (AC-10)", () => {
  it("allows many addresses but at most one default per customer", async () => {
    const customer = await createCustomer();
    await testDb.customerAddress.create({ data: address(customer.id, true) });
    await testDb.customerAddress.create({ data: address(customer.id) });
    await testDb.customerAddress.create({ data: address(customer.id) });

    await expectViolation(
      testDb.customerAddress.create({ data: address(customer.id, true) }),
      SQLSTATE.unique,
      "customer_addresses_one_default_key",
    );
  });

  it("lets two customers each have a default address", async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    await testDb.customerAddress.create({ data: address(a.id, true) });

    await expect(
      testDb.customerAddress.create({ data: address(b.id, true) }),
    ).resolves.toBeDefined();
  });
});

describe("carts (AC-10)", () => {
  it("gives a customer at most one cart, and allows any number of guest carts", async () => {
    const customer = await createCustomer();
    await testDb.cart.create({ data: { customerId: customer.id, expiresAt: inThirtyDays() } });
    await testDb.cart.create({ data: { expiresAt: inThirtyDays() } });
    await testDb.cart.create({ data: { expiresAt: inThirtyDays() } });

    await expectViolation(
      testDb.cart.create({ data: { customerId: customer.id, expiresAt: inThirtyDays() } }),
      SQLSTATE.unique,
      "carts_customer_id_key",
    );
    expect(await testDb.cart.count({ where: { customerId: null } })).toBe(2);
  });

  it("holds at most one line per variant", async () => {
    const { variant } = await createSimpleProduct();
    const cart = await testDb.cart.create({ data: { expiresAt: inThirtyDays() } });
    await testDb.cartItem.create({ data: { cartId: cart.id, variantId: variant.id, quantity: 1 } });

    await expectViolation(
      testDb.cartItem.create({ data: { cartId: cart.id, variantId: variant.id, quantity: 2 } }),
      SQLSTATE.unique,
      "cart_items_cart_id_variant_id_key",
    );
  });

  it.each([0, -1])("rejects a line quantity of %i", async (quantity) => {
    const { variant } = await createSimpleProduct();
    const cart = await testDb.cart.create({ data: { expiresAt: inThirtyDays() } });

    await expectViolation(
      testDb.cartItem.create({ data: { cartId: cart.id, variantId: variant.id, quantity } }),
      SQLSTATE.check,
      "cart_items_quantity_check",
    );
  });
});

describe("customer deletion (AC-7)", () => {
  it("deletes the customer's addresses and cart with its lines", async () => {
    const customer = await createCustomer();
    const { variant } = await createSimpleProduct();
    await testDb.customerAddress.create({ data: address(customer.id, true) });
    await testDb.cart.create({
      data: {
        customerId: customer.id,
        expiresAt: inThirtyDays(),
        items: { create: { variantId: variant.id, quantity: 1 } },
      },
    });

    await testDb.customer.delete({ where: { id: customer.id } });

    expect(await testDb.customerAddress.count()).toBe(0);
    expect(await testDb.cart.count()).toBe(0);
    expect(await testDb.cartItem.count()).toBe(0);
  });
});
