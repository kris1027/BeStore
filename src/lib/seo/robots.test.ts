import { describe, expect, it } from "vitest";

import { robotsRules } from "./robots";

// spec 0018, AC-20.
describe("robotsRules", () => {
  // The env schema already refuses any other value at boot.
  it.each([undefined, "preview", "development"] as const)(
    "blocks everything with no sitemap when VERCEL_ENV is %s",
    (vercelEnv) => {
      expect(robotsRules(vercelEnv, "https://shop.example")).toEqual({
        rules: { userAgent: "*", disallow: "/" },
      });
    },
  );

  it("allows the store in production, keeps admin, api and auth out, and names the sitemap", () => {
    expect(robotsRules("production", "https://shop.example")).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/auth"] },
      sitemap: "https://shop.example/sitemap.xml",
    });
  });
});
