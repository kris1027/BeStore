import { describe, expect, it } from "vitest";

import type { SiteFacts } from "./metadata";
import { breadcrumbJsonLd, organizationJsonLd, websiteJsonLd } from "./structured-data";

const site: SiteFacts = { url: "https://shop.example", name: "BeStore", locale: "en" };

// spec 0018, AC-15 and AC-16.
describe("site JSON-LD", () => {
  it("names the Organization with the site URL and the generated logo", () => {
    expect(organizationJsonLd(site)).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "BeStore",
      url: "https://shop.example/",
      logo: "https://shop.example/logo.png",
    });
  });

  it("names the WebSite with no SearchAction", () => {
    expect(websiteJsonLd(site)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "BeStore",
      url: "https://shop.example/",
    });
  });

  it("starts a breadcrumb at the brand, then the given pages", () => {
    expect(breadcrumbJsonLd(site, [{ name: "Shoes", path: "/categories/shoes" }])).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "BeStore", item: "https://shop.example/" },
        {
          "@type": "ListItem",
          position: 2,
          name: "Shoes",
          item: "https://shop.example/categories/shoes",
        },
      ],
    });
  });
});
