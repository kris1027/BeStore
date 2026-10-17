import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createAdmin, createOrder } from "./fixtures";

// The promo code admin against a real Postgres (spec 0014, AC-10 to AC-14, AC-17 and AC-18).
// The pages' requireAdmin() and the proxy gate are covered by the e2e denial tests.

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), info: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: {
    STORE_CURRENCY: "EUR",
    STORE_TIMEZONE: "Europe/Warsaw",
    STORE_LOCALE: "en",
    STRIPE_SECRET_KEY: "sk_test_abc",
  },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { stripeDashboardUrl: actual.stripeDashboardUrl };
});
vi.mock("stripe", () => ({ default: class {} }));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/logger", async (importOriginal) =>
  (await import("./logger-mock")).mockLoggerModule(importOriginal, {
    info: mocks.info,
    warn: vi.fn(),
    error: vi.fn(),
  }),
);

const { createDiscountCode } = await import("@/features/discounts/actions/create-discount-code");
const { updateDiscountCode } = await import("@/features/discounts/actions/update-discount-code");
const { deleteDiscountCode } = await import("@/features/discounts/actions/delete-discount-code");
const { getDiscountCodes, getDiscountCodeForEdit, DISCOUNT_LIST_LIMIT } =
  await import("@/features/discounts/admin-queries");
const { parseDiscountListParams } = await import("@/features/discounts/list-params");
const { getAdminOrder, getAdminOrders, parseAdminOrdersParams, resolveDiscountFilter } =
  await import("@/features/orders/admin-queries");

resetDatabaseBeforeEach();

let adminId = "";

beforeEach(async () => {
  vi.clearAllMocks();
  const admin = await createAdmin();
  adminId = admin.id;
  mocks.requireAdmin.mockResolvedValue({ id: admin.id, email: admin.email, name: admin.name });
});

function fields(overrides: Record<string, unknown> = {}) {
  return {
    code: "summer10",
    type: "percent",
    value: "10",
    startsAt: "",
    endsAt: "",
    maxRedemptions: "",
    perCustomerLimit: "",
    minSubtotal: "",
    active: true,
    note: "",
    ...overrides,
  };
}

async function create(overrides: Record<string, unknown> = {}) {
  const result = await createDiscountCode(fields(overrides));
  if (!result.ok) throw new Error(`could not create: ${JSON.stringify(result.error)}`);
  return result.data.id;
}

async function editRef(id: string) {
  const row = await testDb.discountCode.findUniqueOrThrow({ where: { id } });
  return { id, loadedUpdatedAt: row.updatedAt.toISOString() };
}

// An order that used the code: paid (a spent use) unless told otherwise.
async function usedBy(
  codeId: string,
  options: {
    status?: "paid" | "pending_payment" | "expired";
    discountCents?: number;
    createdAt?: Date;
  } = {},
) {
  const status = options.status ?? "paid";
  const discountCents = options.discountCents ?? 500;
  const code = await testDb.discountCode.findUniqueOrThrow({ where: { id: codeId } });
  const order = await createOrder({ status, discountCents });
  await testDb.order.update({
    where: { id: order.id },
    data: {
      ...(status === "paid" ? { paidAt: new Date() } : {}),
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      discountCodeId: code.id,
      discountCode: code.code,
      discountType: code.type,
      discountValue: code.value,
    },
  });
  if (status !== "expired") {
    await testDb.discountRedemption.create({
      data: { discountCodeId: codeId, orderId: order.id, email: order.email },
    });
  }
  return order;
}

describe("createDiscountCode (AC-11)", () => {
  it("stores the code uppercased, the dates in UTC and the creating admin, and logs", async () => {
    const id = await create({
      type: "fixed_amount",
      value: "5.50",
      startsAt: "2026-07-01T09:30",
      endsAt: "2026-12-01T09:30",
      maxRedemptions: "100",
      perCustomerLimit: "1",
      minSubtotal: "50",
      note: "  Newsletter  ",
    });

    expect(await testDb.discountCode.findUniqueOrThrow({ where: { id } })).toMatchObject({
      code: "SUMMER10",
      type: "fixed_amount",
      value: 550,
      startsAt: new Date("2026-07-01T07:30:00Z"),
      endsAt: new Date("2026-12-01T08:30:00Z"),
      maxRedemptions: 100,
      perCustomerLimit: 1,
      minSubtotalCents: 5000,
      active: true,
      note: "Newsletter",
      createdByAdminId: adminId,
      updatedByAdminId: null,
    });
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "discount.created", adminId, discountCodeId: id },
      "discount.created",
    );
  });

  it("answers each invalid field with its message", async () => {
    const result = await createDiscountCode(
      fields({
        code: "no",
        value: "101",
        startsAt: "2026-07-01T09:30",
        endsAt: "2026-07-01T09:30",
        maxRedemptions: "0",
        perCustomerLimit: "1.5",
        minSubtotal: "0",
        note: "n".repeat(501),
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        fields: {
          code: "Use 3 to 32 letters, digits or hyphens.",
          value: "Enter a whole percent from 1 to 100.",
          endsAt: "The end must be after the start.",
          maxRedemptions: "Enter a whole number above 0, or leave it empty.",
          perCustomerLimit: "Enter a whole number above 0, or leave it empty.",
          minSubtotal: "Enter an amount above 0, or leave it empty.",
          note: "Keep the note under 500 characters.",
        },
      },
    });
    expect(await testDb.discountCode.count()).toBe(0);
  });

  it("refuses a duplicate code, whatever its case", async () => {
    await create();

    expect(await createDiscountCode(fields({ code: " Summer10 " }))).toEqual({
      ok: false,
      error: { code: "code_taken" },
    });
  });

  it("refuses a caller who is not an admin before reading anything", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));

    await expect(createDiscountCode(fields())).rejects.toThrow();
    await expect(updateDiscountCode({})).rejects.toThrow();
    await expect(deleteDiscountCode({})).rejects.toThrow();
    expect(await testDb.discountCode.count()).toBe(0);
  });
});

describe("updateDiscountCode (AC-12)", () => {
  it("saves, sets the editing admin and logs the changed field names only", async () => {
    const id = await create({ note: "secret plan" });

    const result = await updateDiscountCode({
      ...fields({ value: "15", note: "other plan", active: false }),
      ...(await editRef(id)),
    });

    expect(result).toEqual({ ok: true, data: { id } });
    expect(await testDb.discountCode.findUniqueOrThrow({ where: { id } })).toMatchObject({
      value: 15,
      active: false,
      note: "other plan",
      updatedByAdminId: adminId,
    });
    expect(mocks.info).toHaveBeenCalledWith(
      {
        event: "discount.updated",
        adminId,
        discountCodeId: id,
        changed: ["value", "active", "note"],
      },
      "discount.updated",
    );
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("plan");
  });

  it("refuses a form older than the row", async () => {
    const id = await create();
    const stale = await editRef(id);
    await updateDiscountCode({ ...fields({ value: "20" }), ...(await editRef(id)) });

    expect(await updateDiscountCode({ ...fields({ value: "30" }), ...stale })).toEqual({
      ok: false,
      error: { code: "stale" },
    });
  });

  it("locks code, type and value after the first use, and still allows a lower limit", async () => {
    const id = await create({ maxRedemptions: "10" });
    await usedBy(id);
    await usedBy(id);

    for (const change of [
      { code: "WINTER10" },
      { type: "fixed_amount", value: "10" },
      { value: "11" },
    ]) {
      expect(await updateDiscountCode({ ...fields(change), ...(await editRef(id)) })).toEqual({
        ok: false,
        error: { code: "locked_fields" },
      });
    }
    expect(
      await updateDiscountCode({ ...fields({ maxRedemptions: "1" }), ...(await editRef(id)) }),
    ).toEqual({ ok: true, data: { id } });
    expect((await getDiscountCodeForEdit(id))?.status).toBe("used_up");
  });

  it("answers not_found for a missing code and code_taken for another's code", async () => {
    const id = await create();
    await create({ code: "WINTER" });

    expect(
      await updateDiscountCode({ ...fields({ code: "WINTER" }), ...(await editRef(id)) }),
    ).toEqual({ ok: false, error: { code: "code_taken" } });
    expect(
      await updateDiscountCode({
        ...fields(),
        id: crypto.randomUUID(),
        loadedUpdatedAt: new Date().toISOString(),
      }),
    ).toEqual({ ok: false, error: { code: "not_found" } });
  });
});

describe("deleteDiscountCode (AC-13)", () => {
  it("deletes a code never used, and logs", async () => {
    const id = await create();

    expect(await deleteDiscountCode({ id })).toEqual({ ok: true, data: null });
    expect(await testDb.discountCode.count()).toBe(0);
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "discount.deleted", adminId, discountCodeId: id },
      "discount.deleted",
    );
  });

  it("refuses a code that has been used", async () => {
    const id = await create();
    await usedBy(id);

    expect(await deleteDiscountCode({ id })).toEqual({ ok: false, error: { code: "used" } });
    expect(await testDb.discountCode.count()).toBe(1);
  });

  it("leaves the snapshot text on an expired order that once pointed at the code", async () => {
    const id = await create();
    const order = await usedBy(id, { status: "expired" });

    expect((await deleteDiscountCode({ id })).ok).toBe(true);
    expect(await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      discountCodeId: null,
      discountCode: "SUMMER10",
    });
  });
});

describe("the list (AC-10)", () => {
  it("shows status, uses and discount given under the use rule", async () => {
    const id = await create({ maxRedemptions: "5" });
    await usedBy(id, { discountCents: 300 });
    await usedBy(id, { discountCents: 700 });
    await usedBy(id, { status: "pending_payment", discountCents: 900 });
    await usedBy(id, { status: "pending_payment", createdAt: new Date(Date.now() - 36 * 60_000) });
    await usedBy(id, { status: "expired" });

    const { rows, truncated } = await getDiscountCodes(parseDiscountListParams({}));

    expect(truncated).toBe(false);
    expect(rows).toEqual([
      expect.objectContaining({
        id,
        code: "SUMMER10",
        status: "active",
        uses: 3,
        maxRedemptions: 5,
        discountGivenCents: 1000,
      }),
    ]);
  });

  it("labels each status, the first that applies", async () => {
    const hour = 60 * 60 * 1000;
    const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
    await testDb.discountCode.createMany({
      data: [
        { code: "OFF", active: false, endsAt: iso(-hour) },
        { code: "FULL", maxRedemptions: 1, endsAt: iso(-hour) },
        { code: "OVER", endsAt: iso(-hour) },
        { code: "SOON", startsAt: iso(hour) },
        { code: "NOW" },
      ].map((row) => ({ type: "percent" as const, value: 5, createdByAdminId: adminId, ...row })),
    });
    const full = await testDb.discountCode.findUniqueOrThrow({ where: { code: "FULL" } });
    await usedBy(full.id);

    const { rows } = await getDiscountCodes(parseDiscountListParams({}));
    const statuses = Object.fromEntries(rows.map((row) => [row.code, row.status]));

    expect(statuses).toEqual({
      OFF: "inactive",
      FULL: "used_up",
      OVER: "expired",
      SOON: "scheduled",
      NOW: "active",
    });
    const scheduled = await getDiscountCodes(parseDiscountListParams({ status: "scheduled" }));
    expect(scheduled.rows.map((row) => row.code)).toEqual(["SOON"]);
  });

  it("searches the code as a literal substring, ignoring case", async () => {
    await create({ code: "SUMMER10" });
    await create({ code: "WINTER-10" });
    await create({ code: "AUTUMN" });

    const search = async (q: string) =>
      (await getDiscountCodes(parseDiscountListParams({ q }))).rows.map((row) => row.code);
    expect(await search("mer")).toEqual(["SUMMER10"]);
    expect((await search("10")).toSorted()).toEqual(["SUMMER10", "WINTER-10"]);
    expect(await search("%")).toEqual([]);
  });

  it("shows the newest 200 and says when more match", async () => {
    await testDb.discountCode.createMany({
      data: Array.from({ length: DISCOUNT_LIST_LIMIT + 1 }, (_, index) => ({
        code: `CODE-${String(index).padStart(3, "0")}`,
        type: "percent" as const,
        value: 5,
        createdByAdminId: adminId,
        createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
      })),
    });

    const { rows, truncated } = await getDiscountCodes(parseDiscountListParams({}));

    expect(rows).toHaveLength(DISCOUNT_LIST_LIMIT);
    expect(truncated).toBe(true);
    expect(rows[0]?.code).toBe("CODE-200");
  });

  it("finds no code for a bad or unknown id", async () => {
    expect(await getDiscountCodeForEdit("nope")).toBeNull();
    expect(await getDiscountCodeForEdit(crypto.randomUUID())).toBeNull();
  });
});

describe("the orders that used a code (AC-14)", () => {
  it("filters the order list by code id and names the code for its chip", async () => {
    const id = await create();
    const used = await usedBy(id);
    await createOrder({ status: "paid" });

    const { params, discountCode } = await resolveDiscountFilter(
      parseAdminOrdersParams({ discount: id }),
    );
    expect(discountCode).toBe("SUMMER10");
    expect((await getAdminOrders(params)).rows.map((row) => row.id)).toEqual([used.id]);
  });

  it("ignores an id that is not a code", async () => {
    await createOrder({ status: "paid" });

    const { params, discountCode } = await resolveDiscountFilter(
      parseAdminOrdersParams({ discount: crypto.randomUUID() }),
    );
    expect([params.discount, discountCode]).toEqual([null, null]);
    expect((await getAdminOrders(params)).rows).toHaveLength(1);
  });

  it("shows the order's discount from its own snapshot, and no link once the code is gone", async () => {
    const id = await create({ type: "fixed_amount", value: "5" });
    const order = await usedBy(id, { status: "expired" });

    expect((await getAdminOrder(order.number))?.discount).toEqual({
      codeId: id,
      code: "SUMMER10",
      type: "fixed_amount",
      value: 500,
    });
    await deleteDiscountCode({ id });
    expect((await getAdminOrder(order.number))?.discount).toMatchObject({ codeId: null });
  });
});
