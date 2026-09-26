import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    storage: { from: () => ({ createSignedUploadUrl: mocks.createSignedUploadUrl }) },
  }),
}));

const { createProductImageUpload } = await import("./create-image-upload");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin-1" });
  mocks.createSignedUploadUrl.mockImplementation(async (path: string) => ({
    data: { path, token: "token-1", signedUrl: "http://x" },
    error: null,
  }));
});

// covers: spec 0005 AC-5, AC-15
describe("createProductImageUpload", () => {
  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/avif", "avif"],
  ])("hands out a fresh products/<uuid v7> path for %s, never overwriting", async (type, ext) => {
    const result = await createProductImageUpload({ contentType: type, size: 1000 });

    expect(result).toEqual({
      ok: true,
      data: {
        path: expect.stringMatching(new RegExp(`^products/[0-9a-f-]{36}\\.${ext}$`)),
        token: "token-1",
      },
    });
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(expect.any(String), { upsert: false });
  });

  it("refuses other types and files over 10 MiB without asking Storage", async () => {
    expect(await createProductImageUpload({ contentType: "image/gif", size: 10 })).toEqual({
      ok: false,
      error: "unsupported_type",
    });
    expect(
      await createProductImageUpload({ contentType: "image/png", size: 10 * 1024 * 1024 + 1 }),
    ).toEqual({ ok: false, error: "too_large" });
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  // `in` walks the prototype chain, so an Object.prototype key must not pass as a type.
  it.each(["toString", "constructor", "__proto__"])(
    "refuses the content type %j without asking Storage",
    async (contentType) => {
      expect(await createProductImageUpload({ contentType, size: 10 })).toEqual({
        ok: false,
        error: "unsupported_type",
      });
      expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
    },
  );

  it("checks for an admin before anything else", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(createProductImageUpload({ contentType: "image/png", size: 1 })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});
