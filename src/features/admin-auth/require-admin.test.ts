import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminRow } from "./access";
import { adminPathHeader } from "./proxy-decision";
import {
  adminMetadata,
  redirectIfSignedIn,
  requireAdmin,
  requireAdminSession,
} from "./require-admin";

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
    getAal: vi.fn(),
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
    auth: { getUser: mocks.getUser, mfa: { getAuthenticatorAssuranceLevel: mocks.getAal } },
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
  readonly aal?: "aal1" | "aal2";
  readonly amr?: unknown;
  readonly row?: AdminRow | null;
};

function signedIn({ aal = "aal2", amr, row = activeRow }: SessionSetup = {}) {
  mocks.getUser.mockResolvedValue({ data: { user: { id: ADMIN_ID } } });
  mocks.getAal.mockResolvedValue({
    data: {
      currentLevel: aal,
      currentAuthenticationMethods: amr ?? [{ method: "password", timestamp: nowSeconds - 60 }],
    },
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

describe("requireAdminSession", () => {
  it("returns the admin without the row's disabled flag for a full aal2 session", async () => {
    signedIn();

    await expect(requireAdminSession()).resolves.toEqual({
      admin: { id: ADMIN_ID, email: "admin@example.com", name: "Ada" },
      aal: "aal2",
      fromResetLink: false,
    });
  });

  it("looks up the admin row by the id the Auth server confirmed", async () => {
    signedIn();

    await requireAdminSession();

    expect(mocks.findAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ADMIN_ID } }),
    );
  });

  // covers: AC-1
  it("sends a visitor with no session to sign in, keeping the page they asked for", async () => {
    signedOut();

    await expect(outcome(requireAdminSession)).resolves.toBe(
      "redirect:/admin/sign-in?next=%2Fadmin%2Forders%3Fstatus%3Dpaid",
    );
    expect(mocks.findAdmin).not.toHaveBeenCalled();
  });

  it("sends a visitor with no session to the bare sign in page when the path is unknown", async () => {
    mocks.requestHeaders = new Headers();
    signedOut();

    await expect(outcome(requireAdminSession)).resolves.toBe("redirect:/admin/sign-in");
  });

  it("never carries an unsafe path from the header into next", async () => {
    mocks.requestHeaders = new Headers({ [adminPathHeader]: "//evil.example/admin" });
    signedOut();

    await expect(outcome(requireAdminSession)).resolves.toBe(
      "redirect:/admin/sign-in?next=%2Fadmin",
    );
  });

  // covers: AC-7
  it("sends a session older than 12 hours to sign in with the expired reason and no next", async () => {
    signedIn({ amr: [{ method: "password", timestamp: nowSeconds - 12 * 3600 - 1 }] });

    await expect(outcome(requireAdminSession)).resolves.toBe(
      "redirect:/admin/sign-in?reason=expired",
    );
  });

  // covers: AC-6
  it("answers 404 for a signed in user who is not an admin, and logs the denial", async () => {
    signedIn({ row: null });

    await expect(outcome(requireAdminSession)).resolves.toBe("not-found");
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.access.denied", adminId: ADMIN_ID }),
      "auth.access.denied",
    );
  });

  // covers: AC-6
  it("answers 404 for a disabled admin, even with a full aal2 session", async () => {
    signedIn({ row: { ...activeRow, disabledAt: new Date(NOW_MS - 1000) } });

    await expect(outcome(requireAdminSession)).resolves.toBe("not-found");
  });

  // covers: AC-5
  it("sends a password only (aal1) session to the MFA step, keeping the page", async () => {
    signedIn({ aal: "aal1" });

    await expect(outcome(requireAdminSession)).resolves.toBe(
      "redirect:/admin/mfa?next=%2Fadmin%2Forders%3Fstatus%3Dpaid",
    );
  });

  it("lets an aal1 session through only where the caller allows it", async () => {
    signedIn({ aal: "aal1" });

    await expect(requireAdminSession({ allowAal1: true })).resolves.toMatchObject({ aal: "aal1" });
  });

  // covers: AC-4 (a reset link session may verify a factor, never enroll one)
  it("marks a session opened by a password reset link", async () => {
    signedIn({
      aal: "aal1",
      amr: [{ method: "recovery", timestamp: nowSeconds - 30 }],
    });

    await expect(requireAdminSession({ allowAal1: true })).resolves.toMatchObject({
      fromResetLink: true,
    });
  });
});

describe("requireAdmin", () => {
  it("returns just the admin for an allowed session", async () => {
    signedIn();

    await expect(requireAdmin()).resolves.toEqual({
      id: ADMIN_ID,
      email: "admin@example.com",
      name: "Ada",
    });
  });

  // covers: AC-5 (every admin action calls this guard, so aal1 never runs one)
  it("refuses an aal1 session", async () => {
    signedIn({ aal: "aal1" });

    await expect(outcome(requireAdmin)).resolves.toMatch(/^redirect:\/admin\/mfa/);
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

  it("gives an aal1 session the metadata only where aal1 is allowed", async () => {
    signedIn({ aal: "aal1" });

    await expect(adminMetadata(metadata)).resolves.toEqual({ title: "Page not found" });
    await expect(adminMetadata(metadata, { allowAal1: true })).resolves.toBe(metadata);
  });

  it("never redirects or 404s itself", async () => {
    signedOut();

    await adminMetadata(metadata);

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});

// covers: AC-17
describe("redirectIfSignedIn", () => {
  it("leaves a signed out visitor on the page", async () => {
    signedOut();

    await expect(redirectIfSignedIn(undefined)).resolves.toBeUndefined();
  });

  it("sends an aal1 admin to the MFA step, keeping next", async () => {
    signedIn({ aal: "aal1" });

    await expect(outcome(() => redirectIfSignedIn("/admin/orders"))).resolves.toBe(
      "redirect:/admin/mfa?next=%2Fadmin%2Forders",
    );
  });

  it("sends an aal2 admin to next", async () => {
    signedIn();

    await expect(outcome(() => redirectIfSignedIn("/admin/orders"))).resolves.toBe(
      "redirect:/admin/orders",
    );
  });

  // covers: AC-12
  it("sends an aal2 admin to /admin when next points off site", async () => {
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
