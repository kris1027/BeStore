import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createOrder, inThirtyDays } from "./fixtures";
import { seedPendingOrder } from "./stripe-support";

// Delivery reads and writes against a real Postgres (spec 0007): the checkout prefill, the
// admin settings action, the settings reads, and the address on the admin and confirmation pages.

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  updateTag: vi.fn(),
  info: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: {
    STORE_CURRENCY: "EUR",
    STORE_COUNTRY: "PL",
    STORE_LOCALE: "en",
    STRIPE_SECRET_KEY: "sk_test_abc",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  },
}));
vi.mock("next/cache", () => ({
  updateTag: mocks.updateTag,
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { retrieve: vi.fn() } } },
  stripeDashboardUrl: () => "https://dashboard.stripe.com/test",
}));

const { checkoutPrefill, getCompletion } = await import("@/features/checkout/queries");
const { updateShippingSettings } =
  await import("@/features/settings/actions/update-shipping-settings");
const { getAdminShippingSettings } = await import("@/features/settings/admin-queries");
const { getAdminOrder, getAdminOrders } = await import("@/features/orders/admin-queries");
const { getShippingSettings, readShippingSettings } = await import("@/lib/shipping/settings");

resetDatabaseBeforeEach();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin-1", email: "a@example.com", name: "Ada" });
});

const shipTo = {
  shipFullName: "Anna Kowalska",
  shipLine1: "ul. Marszałkowska 1",
  shipLine2: null,
  shipCity: "Warsaw",
  shipPostalCode: "00-950",
  shipCountryCode: "PL",
  phone: null,
};

async function settingsRow() {
  return testDb.storeSettings.findUniqueOrThrow({
    where: { id: 1 },
    select: { flatShippingCents: true, freeShippingThresholdCents: true },
  });
}

describe("checkoutPrefill (AC-9)", () => {
  async function cart() {
    return testDb.cart.create({ data: { expiresAt: inThirtyDays() } });
  }

  it("fills from the newest order of the cart, whatever its status", async () => {
    const { id: cartId } = await cart();
    const older = await createOrder({ cartId, status: "expired", email: "old@example.com" });
    await testDb.order.update({
      where: { id: older.id },
      data: { ...shipTo, createdAt: new Date("2026-09-01T10:00:00Z") },
    });
    const newer = await createOrder({ cartId, status: "expired", email: "new@example.com" });
    await testDb.order.update({
      where: { id: newer.id },
      data: {
        ...shipTo,
        shipCity: "Kraków",
        shipLine2: "m. 4",
        phone: "600100200",
        createdAt: new Date("2026-09-02T10:00:00Z"),
      },
    });

    expect(await checkoutPrefill(cartId)).toEqual({
      email: "new@example.com",
      fullName: "Anna Kowalska",
      line1: "ul. Marszałkowska 1",
      line2: "m. 4",
      postalCode: "00-950",
      city: "Kraków",
      phone: "600100200",
    });
  });

  it("prefills a null column as an empty field", async () => {
    const { id: cartId } = await cart();
    await createOrder({ cartId, email: "slice1@example.com" });

    expect(await checkoutPrefill(cartId)).toEqual({
      email: "slice1@example.com",
      fullName: "",
      line1: "",
      line2: "",
      postalCode: "",
      city: "",
      phone: "",
    });
  });

  it("never reads another cart's order, and is null for a cart with none", async () => {
    const mine = await cart();
    const theirs = await cart();
    const order = await createOrder({ cartId: theirs.id, email: "them@example.com" });
    await testDb.order.update({ where: { id: order.id }, data: shipTo });

    expect(await checkoutPrefill(mine.id)).toBeNull();
  });
});

describe("shipping settings reads", () => {
  it("read the one row, cached for display and live for Pay", async () => {
    await testDb.storeSettings.update({
      where: { id: 1 },
      data: { flatShippingCents: 1500, freeShippingThresholdCents: 20_000 },
    });
    const expected = { flatShippingCents: 1500, freeShippingThresholdCents: 20_000 };

    expect(await getShippingSettings()).toEqual(expected);
    expect(await testDb.$transaction((tx) => readShippingSettings(tx))).toEqual(expected);
  });

  it("show the admin plain decimals, and an empty threshold field when there is none", async () => {
    expect(await getAdminShippingSettings()).toEqual({
      deliveryFee: "0.00",
      freeDelivery: false,
      freeDeliveryFrom: "",
    });

    await testDb.storeSettings.update({
      where: { id: 1 },
      data: { flatShippingCents: 1200, freeShippingThresholdCents: 5 },
    });

    expect(await getAdminShippingSettings()).toEqual({
      deliveryFee: "12.00",
      freeDelivery: true,
      freeDeliveryFrom: "0.05",
    });
  });
});

describe("updateShippingSettings (AC-10, AC-14)", () => {
  it("saves the fee and threshold, expires the tag and logs who changed what", async () => {
    const result = await updateShippingSettings({
      deliveryFee: "12.50",
      freeDelivery: true,
      freeDeliveryFrom: "200",
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(await settingsRow()).toEqual({
      flatShippingCents: 1250,
      freeShippingThresholdCents: 20_000,
    });
    expect(mocks.updateTag).toHaveBeenCalledWith("store-settings");
    expect(mocks.info).toHaveBeenCalledWith(
      {
        event: "settings.shipping_updated",
        adminId: "admin-1",
        from: { flatShippingCents: 0, freeShippingThresholdCents: null },
        to: { flatShippingCents: 1250, freeShippingThresholdCents: 20_000 },
      },
      "settings.shipping_updated",
    );
  });

  it("clears the threshold when free delivery is switched off", async () => {
    await testDb.storeSettings.update({
      where: { id: 1 },
      data: { flatShippingCents: 900, freeShippingThresholdCents: 10_000 },
    });

    await updateShippingSettings({
      deliveryFee: "9",
      freeDelivery: false,
      freeDeliveryFrom: "100",
    });

    expect(await settingsRow()).toEqual({
      flatShippingCents: 900,
      freeShippingThresholdCents: null,
    });
  });

  it("refuses bad input with a field map and writes nothing", async () => {
    const result = await updateShippingSettings({
      deliveryFee: "9,99",
      freeDelivery: true,
      freeDeliveryFrom: "0",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        fields: {
          deliveryFee: "Enter an amount like 9.99.",
          freeDeliveryFrom: "Enter an amount above 0.",
        },
      },
    });
    expect(await settingsRow()).toEqual({ flatShippingCents: 0, freeShippingThresholdCents: null });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("writes nothing when the caller is not an admin", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));

    await expect(
      updateShippingSettings({ deliveryFee: "50", freeDelivery: false }),
    ).rejects.toThrow();

    expect(await settingsRow()).toEqual({ flatShippingCents: 0, freeShippingThresholdCents: null });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});

describe("the address on admin pages (AC-11, AC-12)", () => {
  it("shows the address, phone and ship to line, or none for an order made before", async () => {
    const withAddress = await createOrder({ status: "paid", shippingCents: 1500 });
    await testDb.order.update({
      where: { id: withAddress.id },
      data: { ...shipTo, shipLine2: "m. 4", phone: "+48 600 100 200" },
    });
    const without = await createOrder({ status: "paid" });

    const page = await getAdminOrders({ all: false, before: null });
    expect(page.rows.map((row) => [row.number, row.shipTo])).toEqual([
      [without.number, null],
      [withAddress.number, "Anna Kowalska, Warsaw"],
    ]);

    expect(await getAdminOrder(withAddress.number)).toMatchObject({
      phone: "+48 600 100 200",
      shippingCents: 1500,
      address: {
        fullName: "Anna Kowalska",
        line1: "ul. Marszałkowska 1",
        line2: "m. 4",
        postalCode: "00-950",
        city: "Warsaw",
        countryName: "Poland",
      },
    });
    expect(await getAdminOrder(without.number)).toMatchObject({ phone: null, address: null });
  });
});

describe("the address on /checkout/complete (AC-13)", () => {
  it("shows where a paid order goes, and nothing for an order made before", async () => {
    const { order } = await seedPendingOrder({ sessionId: "cs_test_paid" });
    await testDb.order.update({ where: { id: order.id }, data: { status: "paid", ...shipTo } });
    const { order: old } = await seedPendingOrder({ suffix: "2", sessionId: "cs_test_old" });
    await testDb.order.update({ where: { id: old.id }, data: { status: "paid" } });

    expect(await getCompletion("cs_test_paid")).toMatchObject({
      state: "paid",
      order: {
        address: {
          fullName: "Anna Kowalska",
          line1: "ul. Marszałkowska 1",
          line2: null,
          postalCode: "00-950",
          city: "Warsaw",
          countryName: "Poland",
        },
      },
    });
    expect(await getCompletion("cs_test_old")).toMatchObject({
      state: "paid",
      order: { address: null },
    });
  });
});
