import { describe, expect, it } from "vitest";

import { imagesStale } from "./image-edit";

// spec 0009, AC-21 for the Images section.

const a = { id: "a", altText: "Front", position: 0, optionValueId: null };
const b = { id: "b", altText: "Back", position: 1, optionValueId: "red" };

describe("imagesStale", () => {
  it("is false while the stored images match what the page loaded", () => {
    expect(imagesStale([a, b], [b, a], [{ id: "b" }, {}])).toBe(false);
  });

  it("is true when an image was added or removed meanwhile", () => {
    expect(imagesStale([a], [a, b], [{ id: "a" }])).toBe(true);
    expect(imagesStale([a, b], [a], [{ id: "a" }])).toBe(true);
  });

  it("is true when alt text, position or the option link changed meanwhile", () => {
    expect(imagesStale([a], [{ ...a, altText: "Side" }], [])).toBe(true);
    expect(imagesStale([a], [{ ...a, position: 3 }], [])).toBe(true);
    expect(imagesStale([a], [{ ...a, optionValueId: "blue" }], [])).toBe(true);
  });

  it("is true when the save keeps an image that is not stored", () => {
    expect(imagesStale([a], [a], [{ id: "zzz" }])).toBe(true);
  });
});
