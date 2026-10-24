import { describe, expect, it } from "vitest";

import { absoluteUrl, openGraphLocale, pageMetadata, type SiteFacts } from "./metadata";

const site: SiteFacts = { url: "https://shop.example", name: "BeStore", locale: "pl-PL" };

const card = {
  url: "https://shop.example/brand-card.png",
  width: 1200,
  height: 630,
  alt: "BeStore",
};

// spec 0018, AC-2.
describe("pageMetadata", () => {
  const metadata = pageMetadata(
    { title: "Shoes", description: "Good shoes", path: "/categories/shoes" },
    site,
  );

  it("sets an absolute canonical and an Open Graph url equal to it", () => {
    expect(metadata.alternates?.canonical).toBe("https://shop.example/categories/shoes");
    expect(metadata.openGraph).toMatchObject({ url: "https://shop.example/categories/shoes" });
  });

  it("fills the share card fields and defaults the image to the brand card", () => {
    expect(metadata).toMatchObject({
      title: "Shoes",
      description: "Good shoes",
      openGraph: {
        type: "website",
        siteName: "BeStore",
        title: "Shoes",
        description: "Good shoes",
        locale: "pl_PL",
        images: [card],
      },
      twitter: { card: "summary_large_image", images: [card] },
    });
  });

  it("uses a given image", () => {
    const image = { url: "https://cdn.example/a.jpg", width: 800, height: 1000, alt: "A" };
    const withImage = pageMetadata({ title: "A", description: null, path: "/a", image }, site);

    expect(withImage.openGraph?.images).toEqual([image]);
    expect(withImage.twitter?.images).toEqual([image]);
  });

  it("leaves out an absent description and a null title", () => {
    const home = pageMetadata({ title: null, description: null, path: "/" }, site);

    expect(home).not.toHaveProperty("title");
    expect(home).not.toHaveProperty("description");
    expect(home.openGraph).toMatchObject({ title: "BeStore" });
    expect(home.openGraph).not.toHaveProperty("description");
  });

  it("shares an absolute title as given", () => {
    const paged = pageMetadata(
      { title: { absolute: "BeStore, page 2" }, description: null, path: "/?page=2" },
      site,
    );

    expect(paged.title).toEqual({ absolute: "BeStore, page 2" });
    expect(paged.openGraph).toMatchObject({ title: "BeStore, page 2" });
  });

  it("marks a page that is not indexable noindex, follow, with no canonical (AC-17)", () => {
    const search = pageMetadata(
      { title: "Search", description: null, path: "/search", indexable: false },
      site,
    );

    expect(search.robots).toEqual({ index: false, follow: true });
    expect(search).not.toHaveProperty("alternates");
    expect(search.openGraph?.images).toEqual([card]);
  });
});

describe("openGraphLocale", () => {
  it("writes a region tag with an underscore and omits a bare language", () => {
    expect(openGraphLocale("pl-PL")).toBe("pl_PL");
    expect(openGraphLocale("en-GB")).toBe("en_GB");
    expect(openGraphLocale("en")).toBeUndefined();
  });
});

describe("absoluteUrl", () => {
  it("resolves a path, query included, on the site origin", () => {
    expect(absoluteUrl("/categories/a?page=2", site)).toBe(
      "https://shop.example/categories/a?page=2",
    );
  });
});
