import { beforeEach, describe, expect, it, vi } from "vitest";

import { addAuthUser, addVerifiedFactor, resetAuthStub } from "./auth-stub";
import { resetDatabaseBeforeEach, testDb } from "./client";
import { createCustomer, createOrder, createSimpleProduct, inThirtyDays } from "./fixtures";

// Settings (spec 0012, AC-18 to AC-20) against a real Postgres; Supabase is mocked at the edge.

const mocks = vi.hoisted(() => {
  class NavigationSignal extends Error {}
  return {
    NavigationSignal,
    redirect: vi.fn((url: string) => {
      throw new NavigationSignal(`redirect:${url}`);
    }),
    customer: { id: "", email: "" },
    refresh: vi.fn(),
    statelessSignIn: vi.fn(),
    statelessSignOut: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    deleteUser: vi.fn(),
    clearAuthCookies: vi.fn(),
    clearCartCookie: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: mocks.error },
}));
vi.mock("@/lib/customer/session", () => ({ requireCustomer: async () => mocks.customer }));
vi.mock("@/lib/cart/cookie", () => ({ clearCartCookie: mocks.clearCartCookie }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { deleteUser: mocks.deleteUser } } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseStatelessClient: () => ({
    auth: { signInWithPassword: mocks.statelessSignIn, signOut: mocks.statelessSignOut },
  }),
  createSupabaseServerClient: async () => ({
    auth: { updateUser: mocks.updateUser, signOut: mocks.signOut },
  }),
  clearAuthCookies: mocks.clearAuthCookies,
}));

const { changePassword, deleteAccount, updateProfile } =
  await import("@/features/account/actions/settings");

resetDatabaseBeforeEach();

async function outcome<T>(run: () => Promise<T>): Promise<T | string> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof mocks.NavigationSignal) return error.message;
    throw error;
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetAuthStub();
  const customer = await createCustomer("ada@example.com");
  await addAuthUser(customer.id);
  mocks.customer = { id: customer.id, email: customer.email };
  mocks.statelessSignIn.mockResolvedValue({ data: { user: { id: customer.id } }, error: null });
  mocks.statelessSignOut.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.deleteUser.mockResolvedValue({ data: {}, error: null });
});

describe("updateProfile (AC-18)", () => {
  it("saves a trimmed name and a checked phone, and clears them when empty", async () => {
    expect(await updateProfile({ name: "  Ada Lovelace ", phone: "+48 600 100 200" })).toEqual({
      ok: true,
      data: { name: "Ada Lovelace", phone: "+48 600 100 200" },
    });
    expect(await updateProfile({ name: "", phone: "" })).toEqual({
      ok: true,
      data: { name: null, phone: null },
    });
  });

  it("refuses a phone checkout would refuse", async () => {
    const result = await updateProfile({ name: "Ada", phone: "123" });

    expect(result).toEqual({
      ok: false,
      error: {
        fields: { phone: ["Enter a phone number with 7 to 15 digits, or leave it empty."] },
      },
    });
  });
});

describe("changePassword (AC-19)", () => {
  const values = {
    currentPassword: "Old-pass-11",
    password: "New-pass-22!",
    confirm: "New-pass-22!",
  };

  it("checks the current password on a throwaway session, then changes it and ends other sessions", async () => {
    expect(await changePassword(values)).toEqual({ ok: true, data: null });
    expect(mocks.statelessSignIn).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "Old-pass-11",
    });
    expect(mocks.statelessSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "New-pass-22!" });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("answers a wrong current password and changes nothing", async () => {
    mocks.statelessSignIn.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", status: 400 },
    });

    expect(await changePassword(values)).toEqual({ ok: false, error: { form: "wrong_password" } });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("refuses an admin and anyone with an authenticator", async () => {
    await testDb.adminUser.create({
      data: { id: mocks.customer.id, email: "ada@example.com", name: "Ada" },
    });
    expect(await changePassword(values)).toEqual({ ok: false, error: { form: "runs_the_store" } });

    await testDb.adminUser.deleteMany();
    await addVerifiedFactor(mocks.customer.id);
    expect(await changePassword(values)).toEqual({ ok: false, error: { form: "runs_the_store" } });
    expect(mocks.statelessSignIn).not.toHaveBeenCalled();
  });
});

describe("deleteAccount (AC-20)", () => {
  it("deletes the row, its addresses and cart, unlinks orders, deletes the login, and clears cookies", async () => {
    const { id } = mocks.customer;
    const { variant } = await createSimpleProduct("a", 5);
    await testDb.customerAddress.create({
      data: {
        customerId: id,
        fullName: "Ada",
        line1: "1 Main St",
        city: "Warsaw",
        postalCode: "00-001",
        countryCode: "PL",
      },
    });
    await testDb.cart.create({
      data: {
        customerId: id,
        expiresAt: inThirtyDays(),
        items: { create: [{ variantId: variant.id, quantity: 1 }] },
      },
    });
    const order = await createOrder({ customerId: id, email: "ada@example.com", status: "paid" });

    expect(await outcome(() => deleteAccount({ password: "Pass-word-1" }))).toBe(
      "redirect:/?notice=account_deleted",
    );

    expect(await testDb.customer.findUnique({ where: { id } })).toBeNull();
    expect(await testDb.customerAddress.count()).toBe(0);
    expect(await testDb.cart.count()).toBe(0);
    const kept = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(kept).toMatchObject({ customerId: null, email: "ada@example.com" });
    expect(mocks.deleteUser).toHaveBeenCalledWith(id);
    expect(mocks.clearAuthCookies).toHaveBeenCalled();
    expect(mocks.clearCartCookie).toHaveBeenCalled();
  });

  it("rolls everything back when Supabase refuses the delete", async () => {
    mocks.deleteUser.mockResolvedValue({
      data: null,
      error: { name: "AuthApiError", status: 500 },
    });

    expect(await deleteAccount({ password: "Pass-word-1" })).toEqual({
      ok: false,
      error: { form: "delete_failed" },
    });
    expect(await testDb.customer.findUnique({ where: { id: mocks.customer.id } })).not.toBeNull();
    expect(mocks.clearAuthCookies).not.toHaveBeenCalled();
  });

  it("refuses an admin before asking for anything, and logs it", async () => {
    await testDb.adminUser.create({
      data: {
        id: mocks.customer.id,
        email: "ada@example.com",
        name: "Ada",
        disabledAt: new Date(),
      },
    });

    expect(await deleteAccount({ password: "Pass-word-1" })).toEqual({
      ok: false,
      error: { form: "runs_the_store" },
    });
    expect(mocks.statelessSignIn).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      { event: "account.delete_refused_admin", customerId: mocks.customer.id },
      "account.delete_refused_admin",
    );
  });

  it("needs the right password", async () => {
    mocks.statelessSignIn.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", status: 400 },
    });

    expect(await deleteAccount({ password: "Wrong-1" })).toEqual({
      ok: false,
      error: { form: "wrong_password" },
    });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
