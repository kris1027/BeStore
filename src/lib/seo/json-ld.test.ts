import { describe, expect, it } from "vitest";

import { serializeJsonLd } from "./json-ld";

// spec 0018, AC-11.
describe("serializeJsonLd", () => {
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "</script><script>alert(1)</script>",
  } as const;
  const text = serializeJsonLd(data);

  it("never writes a `<`, so the text cannot close the script tag", () => {
    expect(text).not.toContain("<");
    expect(text).toContain("\\u003c/script>");
  });

  it("parses back to the same data", () => {
    expect(JSON.parse(text)).toEqual(data);
  });
});
