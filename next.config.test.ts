import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";
import { productImagesConfig } from "./src/lib/image-config";

describe("next config", () => {
  it("keeps Server Function arguments out of the dev log, so passwords and codes never print", () => {
    expect(nextConfig.logging).toMatchObject({ serverFunctions: false });
  });
});

describe("confirmation page headers", () => {
  // spec 0006, AC-11 and spec 0012, AC-2: both URLs carry a key.
  it.each(["/checkout/complete", "/account/confirm"])(
    "sends no referrer and noindex on %s",
    async (source) => {
      const rules = (await nextConfig.headers?.()) ?? [];
      const rule = rules.find((entry) => entry.source === source);

      expect(rule?.headers).toEqual(
        expect.arrayContaining([
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
        ]),
      );
    },
  );
});

describe("productImagesConfig", () => {
  it("allows only the public product-images bucket of a deployed project", () => {
    expect(productImagesConfig("https://abc.supabase.co")).toEqual({
      remotePatterns: [
        {
          protocol: "https",
          hostname: "abc.supabase.co",
          port: "",
          pathname: "/storage/v1/object/public/product-images/**",
        },
      ],
    });
  });

  it("allows a local address only for the local stack", () => {
    const local = productImagesConfig("http://127.0.0.1:55321");
    expect(local.dangerouslyAllowLocalIP).toBe(true);
    expect(local.remotePatterns?.[0]).toMatchObject({ protocol: "http", port: "55321" });
  });
});
