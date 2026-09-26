import { describe, expect, it } from "vitest";

import { uuidv7 } from "@/lib/uuid";

import {
  IMAGE_CONTENT_TYPES,
  isImageContentType,
  MAX_IMAGE_BYTES,
  PRODUCT_IMAGE_PATH,
} from "./product-image-rules";

// spec 0005, AC-5: only the four image types, at most 10 MiB, at a fresh products/<uuid v7> path.

describe("isImageContentType", () => {
  it("accepts exactly PNG, JPEG, WebP and AVIF", () => {
    expect(IMAGE_CONTENT_TYPES.toSorted()).toEqual([
      "image/avif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    for (const type of IMAGE_CONTENT_TYPES) expect(isImageContentType(type)).toBe(true);
  });

  it.each([
    "image/gif",
    "image/svg+xml",
    "text/plain",
    "IMAGE/PNG",
    "",
    "toString",
    "__proto__",
    null,
    42,
  ])("refuses %j", (value) => {
    expect(isImageContentType(value)).toBe(false);
  });
});

describe("MAX_IMAGE_BYTES", () => {
  it("is 10 MiB", () => {
    expect(MAX_IMAGE_BYTES).toBe(10_485_760);
  });
});

describe("PRODUCT_IMAGE_PATH", () => {
  it.each(["png", "jpg", "webp", "avif"])("accepts a uuid v7 path ending in .%s", (ext) => {
    expect(PRODUCT_IMAGE_PATH.test(`products/${uuidv7()}.${ext}`)).toBe(true);
  });

  const id = uuidv7();
  it.each([
    ["another folder", `other/${id}.png`],
    ["a nested path", `products/x/${id}.png`],
    ["a path traversal", `products/../${id}.png`],
    ["a leading slash", `/products/${id}.png`],
    ["a uuid v4", "products/0b7e6b2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b.png"],
    ["upper case hex", `products/${id.toUpperCase()}.png`],
    ["a jpeg extension", `products/${id}.jpeg`],
    ["an svg", `products/${id}.svg`],
    ["a trailing suffix", `products/${id}.png.exe`],
    ["no extension", `products/${id}`],
  ])("refuses %s", (_, path) => {
    expect(PRODUCT_IMAGE_PATH.test(path)).toBe(false);
  });
});
