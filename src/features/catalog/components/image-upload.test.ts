import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProductImageUpload: vi.fn(),
  uploadToSignedUrl: vi.fn(),
  from: vi.fn(),
  createClient: vi.fn(),
  createImageBitmap: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../actions/create-image-upload", () => ({
  createProductImageUpload: mocks.createProductImageUpload,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

const { uploadErrors, uploadImage } = await import("./image-upload");

const storage = { url: "http://storage.test", anonKey: "anon-key" };
const path = "products/01890000-0000-7000-8000-000000000001.png";

function file(type = "image/png", size = 1024) {
  return new File([new Uint8Array(size)], "photo.png", { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("createImageBitmap", mocks.createImageBitmap);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  mocks.createImageBitmap.mockResolvedValue({ width: 800, height: 600, close: mocks.close });
  mocks.createProductImageUpload.mockResolvedValue({
    ok: true,
    data: { path, token: "token-1" },
  });
  mocks.from.mockReturnValue({ uploadToSignedUrl: mocks.uploadToSignedUrl });
  mocks.createClient.mockReturnValue({ storage: { from: mocks.from } });
  mocks.uploadToSignedUrl.mockResolvedValue({ data: { path }, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// covers: spec 0005 AC-5, spec 0009 AC-13 (each image of the gallery goes through this upload)
describe("uploadImage", () => {
  it("uploads with the one time token and answers the path, the size and a preview", async () => {
    const image = file();

    const result = await uploadImage(image, storage);

    expect(result).toEqual({
      ok: true,
      image: { path, width: 800, height: 600, previewUrl: "blob:preview" },
    });
    expect(mocks.createProductImageUpload).toHaveBeenCalledWith({
      contentType: "image/png",
      size: 1024,
    });
    expect(mocks.from).toHaveBeenCalledWith("product-images");
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(path, "token-1", image, {
      contentType: "image/png",
    });
    expect(mocks.close).toHaveBeenCalled();
  });

  it("never keeps a browser session for the anon upload client", async () => {
    await uploadImage(file(), storage);

    expect(mocks.createClient).toHaveBeenCalledWith("http://storage.test", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it.each(["image/gif", "image/svg+xml", "application/pdf", ""])(
    "refuses the type %j before asking the server",
    async (type) => {
      expect(await uploadImage(file(type), storage)).toEqual({
        ok: false,
        error: "unsupported_type",
      });
      expect(mocks.createProductImageUpload).not.toHaveBeenCalled();
    },
  );

  it("accepts 10 MB exactly and refuses one byte more", async () => {
    const limit = 10 * 1024 * 1024;
    expect((await uploadImage(file("image/jpeg", limit), storage)).ok).toBe(true);
    expect(await uploadImage(file("image/jpeg", limit + 1), storage)).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("refuses a file the browser cannot decode as an image", async () => {
    mocks.createImageBitmap.mockRejectedValue(new DOMException("bad", "InvalidStateError"));

    expect(await uploadImage(file(), storage)).toEqual({ ok: false, error: "unreadable" });
    expect(mocks.createProductImageUpload).not.toHaveBeenCalled();
  });

  it.each([
    [10_000, 10_000, true],
    [10_001, 10, false],
    [10, 10_001, false],
  ])("for %i by %i pixels answers ok %s", async (width, height, ok) => {
    mocks.createImageBitmap.mockResolvedValue({ width, height, close: mocks.close });

    const result = await uploadImage(file(), storage);

    expect(result.ok).toBe(ok);
    if (!result.ok) expect(result.error).toBe("dimensions");
  });

  it("passes the server's refusal through without uploading", async () => {
    mocks.createProductImageUpload.mockResolvedValue({ ok: false, error: "unavailable" });

    expect(await uploadImage(file(), storage)).toEqual({ ok: false, error: "unavailable" });
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("answers failed when Storage refuses the upload, with no preview made", async () => {
    mocks.uploadToSignedUrl.mockResolvedValue({ data: null, error: new Error("403") });

    expect(await uploadImage(file(), storage)).toEqual({ ok: false, error: "failed" });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("has a message for every error it can answer", () => {
    expect(Object.keys(uploadErrors).sort()).toEqual([
      "dimensions",
      "failed",
      "too_large",
      "unavailable",
      "unreadable",
      "unsupported_type",
    ]);
  });
});
