import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";
import { productImagesConfig } from "./src/lib/image-config";

describe("next config", () => {
  it("keeps Server Function arguments out of the dev log, so passwords and codes never print", () => {
    expect(nextConfig.logging).toMatchObject({ serverFunctions: false });
  });
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
