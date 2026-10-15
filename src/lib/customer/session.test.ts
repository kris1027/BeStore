import { beforeEach, describe, expect, it, vi } from "vitest";

// spec 0012, AC-10 and AC-13: who the signed in customer is, with Supabase and the database mocked.
// The real row writes run in tests/db/account-setup.db.test.ts.

const mocks = vi.hoisted(() => {
  class NavigationSignal extends Error {}
  return {
    NavigationSignal,
    redirect: vi.fn((url: string) => {
      throw new NavigationSignal(`redirect:${url}`);
    }),
    getUser: vi.fn(),
    findUnique: vi.fn(),
    transaction: vi.fn(),
    lockCustomer: vi.fn(),
    ensureCustomerRow: vi.fn(),
    logAccountEvent: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
// React's cache() memoizes per request; outside one each call runs on its own.
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    customer: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("./lock", () => ({ lockCustomer: mocks.lockCustomer }));
vi.mock("./setup", () => ({ ensureCustomerRow: mocks.ensureCustomerRow }));
vi.mock("./log", () => ({ logAccountEvent: mocks.logAccountEvent }));

const { customerIdentity, getCustomer, requireCustomer } = await import("./session");

const USER_ID = "33333333-3333-3333-3333-333333333333";
const confirmedUser = {
  id: USER_ID,
  email: "Ada@Example.com",
  email_confirmed_at: "2026-10-14T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: confirmedUser } });
  mocks.findUnique.mockResolvedValue({ email: "ada@example.com" });
  mocks.transaction.mockImplementation(async (run: (tx: object) => Promise<unknown>) => run({}));
  mocks.ensureCustomerRow.mockResolvedValue(true);
});

describe("customerIdentity", () => {
  it("is the user id and the lower cased email", () => {
    expect(customerIdentity(confirmedUser)).toEqual({ id: USER_ID, email: "ada@example.com" });
  });

  it("is null before the email is confirmed, or with no email", () => {
    expect(customerIdentity({ ...confirmedUser, email_confirmed_at: undefined })).toBeNull();
    expect(customerIdentity({ ...confirmedUser, email: undefined })).toBeNull();
  });
});

describe("getCustomer", () => {
  it("returns the confirmed customer without a write when the row is in step", async () => {
    expect(await getCustomer()).toEqual({ id: USER_ID, email: "ada@example.com" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("is null when Supabase knows no user (signed out, revoked or deleted)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    expect(await getCustomer()).toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("is null for an unconfirmed user", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { ...confirmedUser, email_confirmed_at: undefined } },
    });

    expect(await getCustomer()).toBeNull();
  });

  it("creates or updates the row under the customer lock when it is missing or stale", async () => {
    mocks.findUnique.mockResolvedValue(null);

    expect(await getCustomer()).toEqual({ id: USER_ID, email: "ada@example.com" });
    expect(mocks.lockCustomer).toHaveBeenCalledWith({}, USER_ID);
    expect(mocks.ensureCustomerRow).toHaveBeenCalledWith(
      {},
      { id: USER_ID, email: "ada@example.com" },
    );
  });

  it("reads a live email conflict as signed out and logs only the id", async () => {
    mocks.findUnique.mockResolvedValue({ email: "old@example.com" });
    mocks.ensureCustomerRow.mockResolvedValue(false);

    expect(await getCustomer()).toBeNull();
    expect(mocks.logAccountEvent).toHaveBeenCalledWith("account.email_conflict", {
      customerId: USER_ID,
    });
  });
});

describe("requireCustomer (AC-13)", () => {
  it("returns the signed in customer", async () => {
    expect(await requireCustomer()).toEqual({ id: USER_ID, email: "ada@example.com" });
  });

  it("sends anyone else to sign in", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    await expect(requireCustomer()).rejects.toThrow("redirect:/account/sign-in");
  });
});
