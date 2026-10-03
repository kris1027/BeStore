import { describe, expect, it } from "vitest";

import { orderLineImage } from "./order-image";

// spec 0009, AC-15: order_lines.image_path is the first image of the gallery rule.

const red = "value-red";
const blue = "value-blue";

describe("orderLineImage", () => {
  it("prefers the first image of one of the variant's option values", () => {
    const images = [
      { storagePath: "general.jpg", position: 0, optionValueId: null },
      { storagePath: "blue.jpg", position: 1, optionValueId: blue },
      { storagePath: "red-2.jpg", position: 3, optionValueId: red },
      { storagePath: "red-1.jpg", position: 2, optionValueId: red },
    ];

    expect(orderLineImage(images, ["value-s", red])).toBe("red-1.jpg");
  });

  it("falls back to the first image tied to no value", () => {
    const images = [
      { storagePath: "second.jpg", position: 1, optionValueId: null },
      { storagePath: "blue.jpg", position: 0, optionValueId: blue },
    ];

    expect(orderLineImage(images, [red])).toBe("second.jpg");
  });

  it("never takes another value's photo, and is null without a match", () => {
    expect(
      orderLineImage([{ storagePath: "blue.jpg", position: 0, optionValueId: blue }], [red]),
    ).toBeNull();
    expect(orderLineImage([], [red])).toBeNull();
  });
});
