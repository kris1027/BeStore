import { describe, expect, it } from "vitest";

import { expectViolation, SQLSTATE, testDb, resetDatabaseBeforeEach } from "./client";
import {
  createAdmin,
  createCustomer,
  createOrder,
  createProductWithOptions,
  createSimpleProduct,
  inThirtyDays,
} from "./fixtures";

resetDatabaseBeforeEach();

describe("the order thread (happy path)", () => {
  it("takes a cart through a pending order, payment with a stock decrement, and a partial refund", async () => {
    const { product, variants } = await createProductWithOptions();
    const variant = variants[0]!;
    const cart = await testDb.cart.create({
      data: {
        expiresAt: inThirtyDays(),
        items: { create: { variantId: variant.id, quantity: 2 } },
      },
    });

    const order = await testDb.order.create({
      data: {
        cartId: cart.id,
        email: "ada@example.com",
        currency: "EUR",
        subtotalCents: 6000,
        shippingCents: 1500,
        totalCents: 7500,
        lines: {
          create: {
            variantId: variant.id,
            productId: product.id,
            productName: product.name,
            variantLabel: "S / Red",
            sku: variant.sku,
            unitPriceCents: 3000,
            quantity: 2,
            lineTotalCents: 6000,
          },
        },
        events: { create: { type: "created", toStatus: "pending_payment", actorType: "customer" } },
      },
      include: { lines: true },
    });
    expect(order.number).toBe(1001);

    // The webhook: event row, status change and stock decrement in one transaction.
    await testDb.$transaction(async (tx) => {
      await tx.stripeEvent.create({ data: { id: "evt_1", type: "checkout.session.completed" } });
      await tx.order.update({
        where: { id: order.id },
        data: { status: "paid", paidAt: new Date(), stripePaymentIntentId: "pi_1" },
      });
      const decremented = await tx.$executeRaw`
        UPDATE product_variants SET stock_quantity = stock_quantity - 2
        WHERE id = ${variant.id}::uuid AND stock_quantity >= 2`;
      expect(decremented).toBe(1);
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "status_changed",
          fromStatus: "pending_payment",
          toStatus: "paid",
          actorType: "system",
        },
      });
    });

    const admin = await createAdmin();
    await testDb.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          orderId: order.id,
          amountCents: 3000,
          actorType: "admin",
          adminId: admin.id,
          lines: { create: { orderLineId: order.lines[0]!.id, quantity: 1, restocked: true } },
        },
      });
      await tx.refund.update({
        where: { id: refund.id },
        data: { status: "succeeded", succeededAt: new Date(), stripeRefundId: "re_1" },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { refundedCents: { increment: 3000 } },
      });
    });

    const stored = await testDb.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { lines: true, events: true, refunds: { include: { lines: true } } },
    });
    expect(stored).toMatchObject({ status: "paid", totalCents: 7500, refundedCents: 3000 });
    expect(stored.events).toHaveLength(2);
    expect(stored.refunds[0]?.lines[0]?.quantity).toBe(1);
    const after = await testDb.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockQuantity).toBe(1);
  });
});

describe("order numbers (AC-12)", () => {
  it("are assigned by the database from 1001 up, even for raw inserts", async () => {
    const first = await createOrder();
    const second = await createOrder();
    const [raw] = await testDb.$queryRaw<{ number: number }[]>`
      INSERT INTO orders (id, email, currency, subtotal_cents, total_cents)
      VALUES (${crypto.randomUUID()}::uuid, 'raw@example.com', 'EUR', 100, 100)
      RETURNING number`;

    expect([first.number, second.number, raw?.number]).toEqual([1001, 1002, 1003]);
  });

  it("are unique", async () => {
    const order = await createOrder();

    await expectViolation(
      testDb.$executeRaw`
        INSERT INTO orders (id, number, email, currency, subtotal_cents, total_cents)
        VALUES (${crypto.randomUUID()}::uuid, ${order.number}, 'dup@example.com', 'EUR', 100, 100)`,
      SQLSTATE.unique,
      "orders_number_key",
    );
  });
});

describe("snapshots survive catalog changes (AC-3)", () => {
  it("keeps name, label, SKU, image and price through rename, reprice, archive and hard delete", async () => {
    const { product, variant } = await createSimpleProduct();
    const order = await createOrder({ subtotalCents: 2500 });
    const line = await testDb.orderLine.create({
      data: {
        orderId: order.id,
        variantId: variant.id,
        productId: product.id,
        productName: "Tee 1",
        variantLabel: null,
        sku: variant.sku,
        imagePath: "products/tee/1.jpg",
        unitPriceCents: 2500,
        quantity: 1,
        lineTotalCents: 2500,
      },
    });
    const snapshot = {
      productName: "Tee 1",
      variantLabel: null,
      sku: variant.sku,
      imagePath: "products/tee/1.jpg",
      unitPriceCents: 2500,
    };

    await testDb.product.update({ where: { id: product.id }, data: { name: "Renamed tee" } });
    await testDb.productVariant.update({
      where: { id: variant.id },
      data: { priceCents: 9900, sku: "SKU-NEW", archived: true },
    });
    const afterEdits = await testDb.orderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(afterEdits).toMatchObject({ ...snapshot, variantId: variant.id, productId: product.id });

    // Bypasses the app rule (archive, never delete) to prove the safety net.
    await testDb.$executeRaw`DELETE FROM products WHERE id = ${product.id}::uuid`;

    const afterDelete = await testDb.orderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(afterDelete).toMatchObject({ ...snapshot, variantId: null, productId: null });
  });
});

describe("money (AC-6)", () => {
  it("stores every money column as an integer", async () => {
    const columns = await testDb.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name LIKE '%\_cents'`;

    expect(columns.length).toBeGreaterThan(10);
    expect(columns.filter((c) => c.data_type !== "integer")).toEqual([]);
  });

  const orderRow = (values: {
    subtotal: number;
    discount?: number;
    shipping?: number;
    total: number;
    refunded?: number;
  }) => testDb.$executeRaw`
    INSERT INTO orders (id, email, currency, subtotal_cents, discount_cents, shipping_cents, total_cents, refunded_cents)
    VALUES (${crypto.randomUUID()}::uuid, 'a@example.com', 'EUR', ${values.subtotal}, ${values.discount ?? 0},
            ${values.shipping ?? 0}, ${values.total}, ${values.refunded ?? 0})`;

  it("rejects a total that does not add up", async () => {
    await expectViolation(
      orderRow({ subtotal: 5000, discount: 500, shipping: 1000, total: 6000 }),
      SQLSTATE.check,
      "orders_total_cents_sum_check",
    );
  });

  it("rejects a discount above the subtotal", async () => {
    await expectViolation(
      orderRow({ subtotal: 1000, discount: 1500, shipping: 1000, total: 500 }),
      SQLSTATE.check,
      "orders_discount_within_subtotal_check",
    );
  });

  it("rejects refunds above the total", async () => {
    await expectViolation(
      orderRow({ subtotal: 1000, total: 1000, refunded: 1001 }),
      SQLSTATE.check,
      "orders_refunded_within_total_check",
    );
  });

  it("rejects a zero total", async () => {
    await expectViolation(
      orderRow({ subtotal: 1000, discount: 1000, total: 0 }),
      SQLSTATE.check,
      "orders_total_cents_positive_check",
    );
  });

  it("rejects a negative amount", async () => {
    await expectViolation(
      orderRow({ subtotal: 1000, shipping: -100, total: 900 }),
      SQLSTATE.check,
      "orders_shipping_cents_check",
    );
  });

  it("accepts a total that adds up", async () => {
    await expect(
      orderRow({ subtotal: 5000, discount: 500, shipping: 1000, total: 5500 }),
    ).resolves.toBe(1);
  });

  it("rejects an order line whose total does not add up, or whose discount exceeds it", async () => {
    const order = await createOrder();
    const line = (unit: number, qty: number, discount: number, total: number) =>
      testDb.orderLine.create({
        data: {
          orderId: order.id,
          productName: "Tee",
          sku: "SKU",
          unitPriceCents: unit,
          quantity: qty,
          discountCents: discount,
          lineTotalCents: total,
        },
      });

    await expectViolation(
      line(1000, 2, 100, 2000),
      SQLSTATE.check,
      "order_lines_line_total_cents_sum_check",
    );
    await expectViolation(
      line(1000, 1, 1500, -500),
      SQLSTATE.check,
      "order_lines_discount_within_amount_check",
    );
    await expectViolation(line(1000, 0, 0, 0), SQLSTATE.check, "order_lines_quantity_check");
    await expect(line(1000, 2, 100, 1900)).resolves.toBeDefined();
  });

  it("rejects a refund of zero and a succeeded refund without its time", async () => {
    const order = await createOrder();

    await expectViolation(
      testDb.refund.create({ data: { orderId: order.id, amountCents: 0, actorType: "system" } }),
      SQLSTATE.check,
      "refunds_amount_cents_check",
    );
    await expectViolation(
      testDb.refund.create({
        data: { orderId: order.id, amountCents: 100, actorType: "system", status: "succeeded" },
      }),
      SQLSTATE.check,
      "refunds_succeeded_at_check",
    );
  });
});

describe("guests and customer deletion (AC-7)", () => {
  it("stores a guest order with no customer", async () => {
    const order = await createOrder();

    expect(order.customerId).toBeNull();
  });

  it("never stores an order without an email", async () => {
    await expectViolation(
      testDb.$executeRaw`
        INSERT INTO orders (id, currency, subtotal_cents, total_cents)
        VALUES (${crypto.randomUUID()}::uuid, 'EUR', 100, 100)`,
      SQLSTATE.notNull,
    );
  });

  it("keeps a deleted customer's orders intact and unlinked", async () => {
    const customer = await createCustomer();
    const order = await createOrder({ customerId: customer.id, email: customer.email });

    await testDb.customer.delete({ where: { id: customer.id } });

    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({
      customerId: null,
      email: customer.email,
      totalCents: order.totalCents,
    });
  });
});

describe("once only records (AC-8)", () => {
  it("handles each Stripe event once", async () => {
    await testDb.stripeEvent.create({ data: { id: "evt_1", type: "checkout.session.completed" } });

    await expectViolation(
      testDb.stripeEvent.create({ data: { id: "evt_1", type: "checkout.session.completed" } }),
      SQLSTATE.unique,
      "stripe_events_pkey",
    );
  });

  it("records each email send once per dedupe key", async () => {
    const order = await createOrder();
    const send = {
      orderId: order.id,
      kind: "order_confirmation" as const,
      dedupeKey: `order_confirmation:${order.id}`,
    };
    await testDb.emailSend.create({ data: send });

    await expectViolation(
      testDb.emailSend.create({ data: send }),
      SQLSTATE.unique,
      "email_sends_dedupe_key_key",
    );
  });

  it("allows one redemption per order", async () => {
    const order = await createOrder();
    const code = await testDb.discountCode.create({
      data: { code: "WELCOME", type: "percent", value: 10 },
    });
    const redemption = { discountCodeId: code.id, orderId: order.id, email: order.email };
    await testDb.discountRedemption.create({ data: redemption });

    await expectViolation(
      testDb.discountRedemption.create({ data: redemption }),
      SQLSTATE.unique,
      "discount_redemptions_order_id_key",
    );
  });

  it("allows one pending order per cart, and a new one once the first is no longer pending", async () => {
    const cart = await testDb.cart.create({ data: { expiresAt: inThirtyDays() } });
    const first = await createOrder({ cartId: cart.id });

    await expectViolation(
      createOrder({ cartId: cart.id }),
      SQLSTATE.unique,
      "orders_one_pending_per_cart_key",
    );

    await testDb.order.update({
      where: { id: first.id },
      data: { status: "expired", expiredAt: new Date() },
    });
    await expect(createOrder({ cartId: cart.id })).resolves.toBeDefined();
  });

  it("rejects a reused Stripe checkout session", async () => {
    const order = await createOrder();
    await testDb.order.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: "cs_1" },
    });
    const other = await createOrder();

    await expectViolation(
      testDb.order.update({ where: { id: other.id }, data: { stripeCheckoutSessionId: "cs_1" } }),
      SQLSTATE.unique,
      "orders_stripe_checkout_session_id_key",
    );
  });
});

describe("admins and actors (AC-11)", () => {
  it("cannot delete an admin named on an order event or a refund, only disable them", async () => {
    const order = await createOrder();
    const eventAdmin = await createAdmin("events@example.com");
    const refundAdmin = await createAdmin("refunds@example.com");
    await testDb.orderEvent.create({
      data: { orderId: order.id, type: "note", actorType: "admin", adminId: eventAdmin.id },
    });
    await testDb.refund.create({
      data: { orderId: order.id, amountCents: 100, actorType: "admin", adminId: refundAdmin.id },
    });

    await expectViolation(
      testDb.adminUser.delete({ where: { id: eventAdmin.id } }),
      SQLSTATE.foreignKey,
    );
    await expectViolation(
      testDb.adminUser.delete({ where: { id: refundAdmin.id } }),
      SQLSTATE.foreignKey,
    );
    await expect(
      testDb.adminUser.update({ where: { id: eventAdmin.id }, data: { disabledAt: new Date() } }),
    ).resolves.toBeDefined();
  });

  it("requires an admin exactly when the actor is an admin", async () => {
    const order = await createOrder();
    const admin = await createAdmin();

    await expectViolation(
      testDb.orderEvent.create({ data: { orderId: order.id, type: "note", actorType: "admin" } }),
      SQLSTATE.check,
      "order_events_actor_check",
    );
    await expectViolation(
      testDb.orderEvent.create({
        data: { orderId: order.id, type: "note", actorType: "system", adminId: admin.id },
      }),
      SQLSTATE.check,
      "order_events_actor_check",
    );
    await expectViolation(
      testDb.refund.create({ data: { orderId: order.id, amountCents: 100, actorType: "admin" } }),
      SQLSTATE.check,
      "refunds_actor_check",
    );
    await expectViolation(
      testDb.refund.create({
        data: { orderId: order.id, amountCents: 100, actorType: "customer", adminId: admin.id },
      }),
      SQLSTATE.check,
      "refunds_actor_check",
    );
  });
});

describe("promo codes (AC-5)", () => {
  it("rejects a duplicate code and a code that is not uppercase", async () => {
    await testDb.discountCode.create({ data: { code: "SPRING", type: "percent", value: 10 } });

    await expectViolation(
      testDb.discountCode.create({ data: { code: "SPRING", type: "fixed_amount", value: 500 } }),
      SQLSTATE.unique,
      "discount_codes_code_key",
    );
    await expectViolation(
      testDb.discountCode.create({ data: { code: "Summer", type: "percent", value: 10 } }),
      SQLSTATE.check,
      "discount_codes_code_uppercase_check",
    );
  });

  it.each([
    { type: "percent" as const, value: 0 },
    { type: "percent" as const, value: 101 },
    { type: "fixed_amount" as const, value: 0 },
  ])("rejects a $type value of $value", async ({ type, value }) => {
    await expectViolation(
      testDb.discountCode.create({ data: { code: "BAD", type, value } }),
      SQLSTATE.check,
      "discount_codes_value_check",
    );
  });

  it("rejects an end date that is not after the start", async () => {
    const at = new Date("2026-10-01T00:00:00Z");

    await expectViolation(
      testDb.discountCode.create({
        data: { code: "DATES", type: "percent", value: 10, startsAt: at, endsAt: at },
      }),
      SQLSTATE.check,
      "discount_codes_dates_check",
    );
  });

  it("cannot delete a code that has been redeemed", async () => {
    const order = await createOrder();
    const code = await testDb.discountCode.create({
      data: { code: "USED", type: "percent", value: 10 },
    });
    await testDb.discountRedemption.create({
      data: { discountCodeId: code.id, orderId: order.id, email: order.email },
    });

    await expectViolation(
      testDb.discountCode.delete({ where: { id: code.id } }),
      SQLSTATE.foreignKey,
    );
  });
});

describe("promo redemption race (AC-15)", () => {
  // The spec's pattern: lock the code row, count its redemptions, insert only below the limit.
  // The sleep between count and insert widens the race window; without the lock both would insert.
  const redeem = (codeId: string, orderId: string, email: string) =>
    testDb.$transaction(async (tx) => {
      const [code] = await tx.$queryRaw<{ max_redemptions: number | null }[]>`
        SELECT max_redemptions FROM discount_codes WHERE id = ${codeId}::uuid FOR UPDATE`;
      const used = await tx.discountRedemption.count({ where: { discountCodeId: codeId } });
      await tx.$executeRaw`SELECT pg_sleep(0.2)`;
      if (code?.max_redemptions != null && used >= code.max_redemptions) return false;
      await tx.discountRedemption.create({ data: { discountCodeId: codeId, orderId, email } });
      return true;
    });

  it("lets exactly one of two racing checkouts take the last use of a code", async () => {
    const code = await testDb.discountCode.create({
      data: { code: "LASTONE", type: "percent", value: 10, maxRedemptions: 2 },
    });
    const earlier = await createOrder({ email: "early@example.com" });
    await testDb.discountRedemption.create({
      data: { discountCodeId: code.id, orderId: earlier.id, email: earlier.email },
    });
    const a = await createOrder({ email: "a@example.com" });
    const b = await createOrder({ email: "b@example.com" });

    const results = await Promise.all([
      redeem(code.id, a.id, a.email),
      redeem(code.id, b.id, b.email),
    ]);

    expect(results.toSorted()).toEqual([false, true]);
    expect(await testDb.discountRedemption.count({ where: { discountCodeId: code.id } })).toBe(2);
  });
});
