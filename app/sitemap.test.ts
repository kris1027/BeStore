import { beforeEach, describe, expect, it, vi } from "vitest";

// spec 0018, AC-18: how the sitemap composes its two cached reads with the legal documents. The
// reads themselves (what counts as listed) are proven against a database in
// tests/db/sitemap.db.test.ts.

const mocks = vi.hoisted(() => ({
  getSitemapProducts: vi.fn(),
  getSitemapCategories: vi.fn(),
}));

vi.mock("server-only", () => ({}));
// Another origin than the default, so the test proves every URL follows the env.
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SITE_URL: "https://shop.other.example",
    STORE_LOCALE: "en",
    STORE_COUNTRY: "PL",
    STORE_CURRENCY: "PLN",
    VERCEL_ENV: "development",
  },
}));
vi.mock("@/features/catalog/queries", () => ({ getSitemapProducts: mocks.getSitemapProducts }));
vi.mock("@/features/categories/queries", () => ({
  getSitemapCategories: mocks.getSitemapCategories,
}));

const { default: sitemap } = await import("./sitemap");
const { legalDocuments } = await import("@/lib/legal/documents");
const { legalSlugs } = await import("@/lib/legal/paths");

const origin = "https://shop.other.example";

beforeEach(() => {
  mocks.getSitemapProducts.mockResolvedValue([]);
  mocks.getSitemapCategories.mockResolvedValue([]);
});

describe("sitemap", () => {
  it("lists the home page with no lastModified and the five legal pages with their dates (AC-18)", async () => {
    const entries = await sitemap();

    expect(entries[0]).toEqual({ url: `${origin}/` });
    expect(entries.slice(1)).toEqual(
      legalSlugs.map((slug) => ({
        url: `${origin}${legalDocuments[slug].path}`,
        lastModified: legalDocuments[slug].updated,
      })),
    );
    expect(legalSlugs).toHaveLength(5);
    for (const entry of entries.slice(1)) {
      expect(entry.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("lists each category and product on the site origin with its updated_at (AC-18)", async () => {
    mocks.getSitemapCategories.mockResolvedValue([
      { slug: "scarves", updatedAt: "2026-10-01T10:00:00.000Z" },
    ]);
    mocks.getSitemapProducts.mockResolvedValue([
      {
        slug: "wool-scarf",
        updatedAt: "2026-10-02T11:00:00.000Z",
        imageUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
      },
    ]);

    const entries = await sitemap();

    expect(entries).toContainEqual({
      url: `${origin}/categories/scarves`,
      lastModified: "2026-10-01T10:00:00.000Z",
    });
    expect(entries).toContainEqual({
      url: `${origin}/products/wool-scarf`,
      lastModified: "2026-10-02T11:00:00.000Z",
      images: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
    });
  });

  it("leaves out images for a product with no photo", async () => {
    mocks.getSitemapProducts.mockResolvedValue([
      { slug: "plain-tee", updatedAt: "2026-10-02T11:00:00.000Z", imageUrls: [] },
    ]);

    const entries = await sitemap();

    const tee = entries.find((entry) => entry.url === `${origin}/products/plain-tee`);
    expect(tee).toBeDefined();
    expect(tee).not.toHaveProperty("images");
  });

  it("lists nothing beyond home, legal pages, categories and products", async () => {
    mocks.getSitemapCategories.mockResolvedValue([
      { slug: "scarves", updatedAt: "2026-10-01T10:00:00.000Z" },
    ]);
    mocks.getSitemapProducts.mockResolvedValue([
      { slug: "wool-scarf", updatedAt: "2026-10-02T11:00:00.000Z", imageUrls: [] },
    ]);

    const entries = await sitemap();

    expect(entries).toHaveLength(1 + 5 + 1 + 1);
    for (const { url } of entries) {
      expect(url.startsWith(`${origin}/`)).toBe(true);
      expect(url).not.toContain("?");
    }
  });

  it("fails the render when a read fails, never serving a partial list", async () => {
    mocks.getSitemapProducts.mockRejectedValue(new Error("db down"));

    await expect(sitemap()).rejects.toThrow("db down");
  });
});
