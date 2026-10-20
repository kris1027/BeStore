import { describe, expect, it } from "vitest";

import type { SellerDetails } from "@/lib/brand/brand";

import { loadLegalDocuments, sellerValues, stripLeadingComments } from "./load";
import { legalSlugs, type LegalSlug } from "./paths";

const seller: SellerDetails = {
  name: "Shop sp. z o.o.",
  address: "ul. Długa 1, 00-001 Warszawa",
  taxId: "5250000000",
  registration: "KRS 0000000000",
  email: "hello@example.com",
  phone: "+48 600 000 000",
};

const store = { country: "Poland", currency: "EUR" };

function file(body: string, updated = "2026-10-20"): string {
  return `---\ntitle: T\ndescription: D\nupdated: ${updated}\n---\n\n<!-- DRAFT: mentions [[TO FILL]] -->\n\n${body}\n`;
}

function sources(overrides: Partial<Record<LegalSlug, string>> = {}): Record<LegalSlug, string> {
  const all = Object.fromEntries(legalSlugs.map((slug) => [slug, file(`${slug} body`)]));
  return { ...all, ...overrides } as Record<LegalSlug, string>;
}

describe("loadLegalDocuments", () => {
  it("parses each file into its path, meta and body without the draft note", () => {
    const docs = loadLegalDocuments(sources(), { seller, store, production: true });

    expect(docs.terms).toEqual({
      slug: "terms",
      path: "/terms",
      title: "T",
      description: "D",
      updated: "2026-10-20",
      body: "terms body",
    });
    expect(docs.cookies.path).toBe("/cookies");
  });

  it("fills the seller and store placeholders", () => {
    const docs = loadLegalDocuments(
      sources({
        terms: file("{{seller.name}}, {{seller.address}}, {{store.country}}, {{store.currency}}"),
      }),
      { seller, store, production: true },
    );
    expect(docs.terms.body).toBe("Shop sp. z o.o., ul. Długa 1, 00-001 Warszawa, Poland, EUR");
  });

  // spec 0017, AC-4 and AC-5.
  it("keeps the live shipping placeholders on /shipping only", () => {
    const docs = loadLegalDocuments(
      sources({ shipping: file("{{deliveryFee}}. {{freeDeliveryRule}}") }),
      { seller, store, production: false },
    );
    expect(docs.shipping.body).toBe("{{deliveryFee}}. {{freeDeliveryRule}}");
    expect(() =>
      loadLegalDocuments(sources({ terms: file("{{deliveryFee}}") }), {
        seller,
        store,
        production: false,
      }),
    ).toThrow("{{deliveryFee}}");
  });

  it("throws on an unknown placeholder in any environment", () => {
    expect(() =>
      loadLegalDocuments(sources({ privacy: file("{{seller.fax}}") }), {
        seller,
        store,
        production: false,
      }),
    ).toThrow("{{seller.fax}}");
  });

  it("renders a null seller field as its own marker", () => {
    const docs = loadLegalDocuments(sources({ terms: file("{{seller.address}}") }), {
      seller: { ...seller, address: null },
      store,
      production: false,
    });
    expect(docs.terms.body).toBe("[[TO FILL: seller.address]]");
  });

  describe("the production guard", () => {
    it("lets a marker through outside production, so drafts stay reviewable", () => {
      const docs = loadLegalDocuments(sources({ returns: file("[[TO FILL: carriers]]") }), {
        seller,
        store,
        production: false,
      });
      expect(docs.returns.body).toBe("[[TO FILL: carriers]]");
    });

    it("throws in production on a marker left in a text", () => {
      expect(() =>
        loadLegalDocuments(sources({ returns: file("[[TO FILL: carriers]]") }), {
          seller,
          store,
          production: true,
        }),
      ).toThrow("returns.md still has blanks to fill before launch: [[TO FILL: carriers]]");
    });

    it("throws in production on a seller field still null", () => {
      expect(() =>
        loadLegalDocuments(sources({ terms: file("{{seller.taxId}}") }), {
          seller: { ...seller, taxId: null },
          store,
          production: true,
        }),
      ).toThrow("[[TO FILL: seller.taxId]]");
    });

    it("ignores a marker mentioned in the draft note", () => {
      expect(() =>
        loadLegalDocuments(sources(), { seller, store, production: true }),
      ).not.toThrow();
    });
  });
});

describe("sellerValues", () => {
  it("names every seller placeholder", () => {
    expect(Object.keys(sellerValues(seller)).sort()).toEqual([
      "seller.address",
      "seller.email",
      "seller.name",
      "seller.phone",
      "seller.registration",
      "seller.taxId",
    ]);
  });
});

describe("stripLeadingComments", () => {
  it("removes only comments at the top", () => {
    expect(stripLeadingComments("\n<!-- a -->\n<!-- b -->\ntext <!-- c -->")).toBe(
      "text <!-- c -->",
    );
  });
});
