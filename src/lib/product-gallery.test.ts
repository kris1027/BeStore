import { describe, expect, it } from "vitest";

import { galleryImages } from "./product-gallery";

// spec 0009, AC-15.

const red = "value-red";
const blue = "value-blue";

const images = [
  { name: "general-2", position: 3, optionValueId: null },
  { name: "red-2", position: 4, optionValueId: red },
  { name: "general-1", position: 0, optionValueId: null },
  { name: "blue-1", position: 1, optionValueId: blue },
  { name: "red-1", position: 2, optionValueId: red },
];

const names = (list: readonly { name: string }[]) => list.map((image) => image.name);

describe("galleryImages", () => {
  it("shows the selected value's images first, then the untied ones, each by position", () => {
    expect(names(galleryImages(images, ["value-s", red]))).toEqual([
      "red-1",
      "red-2",
      "general-1",
      "general-2",
    ]);
  });

  it("hides images tied to other values", () => {
    expect(names(galleryImages(images, [blue]))).toEqual(["blue-1", "general-1", "general-2"]);
  });

  it("shows only untied images for a default variant", () => {
    expect(names(galleryImages(images, []))).toEqual(["general-1", "general-2"]);
  });

  it("is empty when every image belongs to another value, or there are none", () => {
    expect(galleryImages([{ position: 0, optionValueId: blue }], [red])).toEqual([]);
    expect(galleryImages([], [red])).toEqual([]);
  });
});
