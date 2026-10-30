import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminRow } from "./access";
import { adminPathHeader } from "./proxy-decision";
import { adminMetadata, redirectIfSignedIn, requireAdmin } from "./require-admin";

const mocks = vi.hoisted(() => {
  class NavigationSignal extends Error {}
  return {
    NavigationSignal,
    redirect: vi.fn((url: string) => {
      throw new NavigationSignal(`redirect:${url}`);
    }),
    notFound: vi.fn(() => {
      throw new NavigationSignal("not-found");
    }),
    requestHeaders: new Headers(),
    getUser: vi.fn(),
    getClaims: vi.fn(),
    findAdmin: vi.fn(),
    warn: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
// Outside a React server render `cache` would dedupe nothing anyway; pass through so every
// test reads the session afresh.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/lib/db", () => ({ db: { adminUser: { findUnique: mocks.findAdmin } } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.getUser, getClaims: mocks.getClaims },
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: mocks.warn } }));

const NOW_MS = Date.UTC(2026, 8, 25, 12, 0, 0);
const nowSeconds = NOW_MS / 1000;
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";

const activeRow: AdminRow = {
  id: ADMIN_ID,
  email: "admin@example.com",
  name: "Ada",
  disabledAt: null,
};

type SessionSetup = {
  readonly amr?: unknown;
  readonly row?: AdminRow | null;
};

const recoveryAmr = [{ method: "recovery", timestamp: nowSeconds - 30 }];

function signedIn({ amr, row = activeRow }: SessionSetup = {}) {
  mocks.getUser.mockResolvedValue({ data: { user: { id: ADMIN_ID } } });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { amr: amr ?? [{ method: "password", timestamp: nowSeconds - 60 }] } },
  });
  mocks.findAdmin.mockResolvedValue(row);
}

function signedOut() {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
}

// Runs the guard and returns where it sent the visitor, or its value when it allowed them.
async function outcome<T>(run: () => Promise<T>): Promise<T | string> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof mocks.NavigationSignal) return error.message;
    throw error;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  mocks.requestHeaders = new Headers({ [adminPathHeader]: "/admin/orders?status=paid" });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requireAdmin", () => {
  it("returns the admin without the row's disabled flag for a password session", async () => {
    signedIn();

    await expect(requireAdmin()).resolves.toEqual({
      id: ADMIN_ID,
      email: "admin@example.com",
      name: "Ada",
    });
  });

  it("looks up the admin row by the id the Auth server confirmed", async () => {
    signedIn();

    await requireAdmin();

    expect(mocks.findAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ADMIN_ID } }),
    );
  });

  // covers: AC-1
  it("sends a visitor with no session to sign in, keeping the page they asked for", async () => {
    signedOut();

    await expect(outcome(requireAdmin)).resolves.toBe(
      "redirect:/admin/sign-in?next=%2Fadmin%2Forders%3Fstatus%3Dpaid",
    );
    expect(mocks.findAdmin).not.toHaveBeenCalled();
  });

  it("sends a visitor with no session to the bare sign in page when the path is unknown", async () => {
    mocks.requestHeaders = new Headers();
    signedOut();

    await expect(outcome(requireAdmin)).resolves.toBe("redirect:/admin/sign-in");
  });

  it("never carries an unsafe path from the header into next", async () => {
    mocks.requestHeaders = new Headers({ [adminPathHeader]: "//evil.example/admin" });
    signedOut();

    await expect(outcome(requireAdmin)).resolves.toBe("redirect:/admin/sign-in?next=%2Fadmin");
  });

  // covers: AC-7
  it("sends a session older than 12 hours to sign in with the expired reason and no next", async () => {
    signedIn({ amr: [{ method: "password", timestamp: nowSeconds - 12 * 3600 - 1 }] });

    await expect(outcome(requireAdmin)).resolves.toBe("redirect:/admin/sign-in?reason=expired");
  });

  // covers: AC-6
  it("answers 404 for a signed in user who is not an admin, and logs the denial", async () => {
    signedIn({ row: null });

    await expect(outcome(requireAdmin)).resolves.toBe("not-found");
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.access.denied", adminId: ADMIN_ID }),
      "auth.access.denied",
    );
  });

  // covers: AC-6
  it("answers 404 for a disabled admin, even with a password session", async () => {
    signedIn({ row: { ...activeRow, disabledAt: new Date(NOW_MS - 1000) } });

    await expect(outcome(requireAdmin)).resolves.toBe("not-found");
  });

  // spec 0019, AC-2: an inbox alone never opens the panel.
  it("sends an admin whose session an email link opened to sign in, keeping the page", async () => {
    signedIn({ amr: recoveryAmr });

    await expect(outcome(requireAdmin)).resolves.toBe(
      "redirect:/admin/sign-in?next=%2Fadmin%2Forders%3Fstatus%3Dpaid",
    );
  });

  it("reads amr from the claims of the confirmed session", async () => {
    signedIn();

    await requireAdmin();

    expect(mocks.getClaims).toHaveBeenCalled();
  });

  it("sends a session whose token cannot be read to a plain sign in, not the expired one", async () => {
    signedIn();
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("invalid JWT") });

    await expect(outcome(requireAdmin)).resolves.toBe(
      "redirect:/admin/sign-in?next=%2Fadmin%2Forders%3Fstatus%3Dpaid",
    );
    expect(mocks.findAdmin).not.toHaveBeenCalled();
  });
});

// covers: AC-6 (no page title hints that the panel exists)
describe("adminMetadata", () => {
  const metadata = { title: "Orders" };

  it("returns the page's metadata to an allowed admin", async () => {
    signedIn();

    await expect(adminMetadata(metadata)).resolves.toBe(metadata);
  });

  it("returns the not found title to a signed out visitor", async () => {
    signedOut();

    await expect(adminMetadata(metadata)).resolves.toEqual({ title: "Page not found" });
  });

  it("returns the not found title to a user who is not an admin", async () => {
    signedIn({ row: null });

    await expect(adminMetadata(metadata)).resolves.toEqual({ title: "Page not found" });
  });

  it("returns nothing for a layout, so the root title template still applies", async () => {
    signedOut();

    await expect(adminMetadata(metadata, { layout: true })).resolves.toEqual({});
  });

  it("returns the not found title to an email link session", async () => {
    signedIn({ amr: recoveryAmr });

    await expect(adminMetadata(metadata)).resolves.toEqual({ title: "Page not found" });
  });

  it("never redirects or 404s itself", async () => {
    signedOut();

    await adminMetadata(metadata);

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});

// covers: spec 0004 AC-17, spec 0019 AC-6
describe("redirectIfSignedIn", () => {
  it("leaves a signed out visitor on the page", async () => {
    signedOut();

    await expect(redirectIfSignedIn(undefined)).resolves.toBeUndefined();
  });

  // spec 0019, AC-6
  it("leaves an admin whose session an email link opened on the page", async () => {
    signedIn({ amr: recoveryAmr });

    await expect(redirectIfSignedIn("/admin/orders")).resolves.toBeUndefined();
  });

  it("sends an admin with a password session to next", async () => {
    signedIn();

    await expect(outcome(() => redirectIfSignedIn("/admin/orders"))).resolves.toBe(
      "redirect:/admin/orders",
    );
  });

  // covers: AC-12
  it("sends an admin to /admin when next points off site", async () => {
    signedIn();

    await expect(outcome(() => redirectIfSignedIn("//evil.example/admin"))).resolves.toBe(
      "redirect:/admin",
    );
  });

  it("ignores a next that is not a string", async () => {
    signedIn();

    await expect(outcome(() => redirectIfSignedIn(["/admin/orders"]))).resolves.toBe(
      "redirect:/admin",
    );
  });

  it("leaves a signed in user who is not an admin on the page", async () => {
    signedIn({ row: null });

    await expect(redirectIfSignedIn("/admin")).resolves.toBeUndefined();
  });

  it("leaves an expired session on the page so the admin can sign in again", async () => {
    signedIn({ amr: [{ method: "password", timestamp: nowSeconds - 13 * 3600 }] });

    await expect(redirectIfSignedIn("/admin")).resolves.toBeUndefined();
  });
});
