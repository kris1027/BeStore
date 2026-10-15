import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createCustomer } from "./fixtures";

// The address book (spec 0012, AC-14) against a real Postgres, through its server actions.

const mocks = vi.hoisted(() => ({
  customer: { id: "", email: "" },
  refresh: vi.fn(),
  info: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { STORE_COUNTRY: "PL" } }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/customer/session", () => ({ requireCustomer: async () => mocks.customer }));

const { createAddress, deleteAddress, setDefaultAddress, updateAddress } =
  await import("@/features/account/actions/addresses");

resetDatabaseBeforeEach();

beforeEach(async () => {
  vi.clearAllMocks();
  const customer = await createCustomer();
  mocks.customer = { id: customer.id, email: customer.email };
});

function typed(overrides: Record<string, string> = {}) {
  return {
    fullName: "Ada Lovelace",
    line1: "ul. Długa 1",
    line2: "",
    postalCode: "00950",
    city: "Warsaw",
    phone: "",
    ...overrides,
  };
}

async function book() {
  return testDb.customerAddress.findMany({
    where: { customerId: mocks.customer.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

describe("createAddress", () => {
  it("saves the address in the stored form, the first one as the default", async () => {
    expect(await createAddress(typed())).toEqual({ ok: true, data: null });
    await createAddress(typed({ city: "Kraków" }));

    const rows = await book();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      city: "Warsaw",
      isDefault: true,
      postalCode: "00-950",
      line2: null,
      phone: null,
      countryCode: "PL",
    });
    expect(rows[1]).toMatchObject({ city: "Kraków", isDefault: false });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("adds nothing for an address equal to a saved one, with null and empty alike", async () => {
    await createAddress(typed());
    await createAddress(typed({ line2: "  ", postalCode: "00-950" }));

    expect(await book()).toHaveLength(1);
  });

  it("refuses an 11th address", async () => {
    for (let i = 0; i < 10; i += 1) await createAddress(typed({ line1: `ul. Długa ${i + 1}` }));

    expect(await createAddress(typed({ line1: "ul. Krótka 1" }))).toEqual({
      ok: false,
      error: { code: "limit_reached" },
    });
    expect(await book()).toHaveLength(10);
  });

  it("returns the field messages of checkout for a bad address", async () => {
    const result = await createAddress(typed({ postalCode: "123", fullName: "" }));

    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        fields: {
          fullName: ["Enter your full name."],
          postalCode: ["Enter a postal code like 00-950."],
        },
      },
    });
  });

  it("keeps one default and at most 10 addresses when saves race", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => createAddress(typed({ line1: `ul. Długa ${i + 1}` }))),
    );

    const rows = await book();
    expect(rows).toHaveLength(10);
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1);
  });
});

describe("updateAddress, deleteAddress and setDefaultAddress", () => {
  it("edits only the customer's own address", async () => {
    await createAddress(typed());
    const [own] = await book();
    const other = await createCustomer();
    const theirs = await testDb.customerAddress.create({
      data: { ...typed(), postalCode: "00-950", customerId: other.id, countryCode: "PL" },
    });

    expect(await updateAddress(own!.id, typed({ city: "Gdańsk" }))).toEqual({
      ok: true,
      data: null,
    });
    expect(await updateAddress(theirs.id, typed({ city: "Gdańsk" }))).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    expect((await book())[0]?.city).toBe("Gdańsk");
    expect((await testDb.customerAddress.findUnique({ where: { id: theirs.id } }))?.city).toBe(
      "Warsaw",
    );
  });

  it("moves the default to the newest remaining address when the default is deleted", async () => {
    await createAddress(typed({ line1: "First 1" }));
    await createAddress(typed({ line1: "Second 2" }));
    await createAddress(typed({ line1: "Third 3" }));
    const [first] = await book();

    expect(await deleteAddress(first!.id)).toEqual({ ok: true, data: null });

    const rows = await book();
    expect(rows[0]).toMatchObject({ line1: "Third 3", isDefault: true });
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1);
  });

  it("changes the default without ever breaking the one default rule, also when racing", async () => {
    await createAddress(typed({ line1: "First 1" }));
    await createAddress(typed({ line1: "Second 2" }));
    await createAddress(typed({ line1: "Third 3" }));
    const rows = await book();

    const results = await Promise.all([
      setDefaultAddress(rows[1]!.id),
      setDefaultAddress(rows[2]!.id),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect((await book()).filter((row) => row.isDefault)).toHaveLength(1);
  });

  it("answers not found for someone else's address or a bad id", async () => {
    const other = await createCustomer();
    const theirs = await testDb.customerAddress.create({
      data: { ...typed(), postalCode: "00-950", customerId: other.id, countryCode: "PL" },
    });

    for (const id of [theirs.id, "not-a-uuid"]) {
      expect(await deleteAddress(id)).toEqual({ ok: false, error: { code: "not_found" } });
      expect(await setDefaultAddress(id)).toEqual({ ok: false, error: { code: "not_found" } });
    }
    expect(await testDb.customerAddress.count({ where: { customerId: other.id } })).toBe(1);
  });
});
