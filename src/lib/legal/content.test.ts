import { describe, expect, it } from "vitest";

import cookies from "./content/cookies.md";
import privacy from "./content/privacy.md";
import returns from "./content/returns.md";
import shipping from "./content/shipping.md";
import terms from "./content/terms.md";
import { parseFrontMatter } from "./front-matter";
import { loadLegalDocuments, sellerValues, shippingPlaceholders } from "./load";
import { legalSlugs } from "./paths";
import { placeholderNames } from "./placeholders";

// spec 0017, AC-4 and AC-7: the five drafts as they ship.
const raw = { terms, privacy, returns, shipping, cookies };

const seller = {
  name: null,
  address: null,
  taxId: null,
  registration: null,
  email: null,
  phone: null,
};
const known = [
  ...Object.keys(sellerValues(seller)),
  "store.country",
  "store.currency",
  ...shippingPlaceholders,
];

describe.each(legalSlugs)("the %s draft", (slug) => {
  const text = raw[slug];

  it("has front matter with a title, a description and a real date", () => {
    expect(() => parseFrontMatter(text, slug)).not.toThrow();
  });

  it("opens its body with the draft note, as an HTML comment", () => {
    expect(parseFrontMatter(text, slug).body.trimStart()).toMatch(/^<!--\s*DRAFT\b[\s\S]*?-->/);
  });

  // The page title is the only h1.
  it("has no level 1 heading", () => {
    expect(parseFrontMatter(text, slug).body).not.toMatch(/^# /m);
  });

  it("uses only known placeholders", () => {
    for (const name of placeholderNames(text)) expect(known).toContain(name);
  });
});

describe("the drafts together", () => {
  it("load outside production with every seller field blank", () => {
    expect(() =>
      loadLegalDocuments(raw, {
        seller,
        store: { country: "Poland", currency: "EUR" },
        production: false,
      }),
    ).not.toThrow();
  });

  // Feature 19 cannot ship while a blank is left (spec 0017, Follow-up).
  it("refuse to load in production while blanks remain", () => {
    expect(() =>
      loadLegalDocuments(raw, {
        seller,
        store: { country: "Poland", currency: "EUR" },
        production: true,
      }),
    ).toThrow("still has blanks to fill before launch");
  });

  // Value sourcing, seller placeholders: one brand.legal field filled clears its marker
  // everywhere, and only its own.
  it("fill one seller field on every page that names it", () => {
    const docs = loadLegalDocuments(raw, {
      seller: { ...seller, name: "Kowalski Shop sp. z o.o." },
      store: { country: "Poland", currency: "EUR" },
      production: false,
    });
    const bodies = legalSlugs.map((slug) => docs[slug].body);

    expect(bodies.some((body) => body.includes("Kowalski Shop sp. z o.o."))).toBe(true);
    for (const body of bodies) expect(body).not.toContain("[[TO FILL: seller.name]]");
    expect(bodies.some((body) => body.includes("[[TO FILL: seller.address]]"))).toBe(true);
  });

  it("put the shipping placeholders on /shipping only", () => {
    for (const slug of legalSlugs) {
      const names = placeholderNames(raw[slug]);
      const live = names.filter((name) =>
        (shippingPlaceholders as readonly string[]).includes(name),
      );
      expect(live.length > 0).toBe(slug === "shipping");
    }
  });

  // AC-6: the model withdrawal form, with the seller's name, address and email.
  it("end /returns with the model withdrawal form", () => {
    const body = parseFrontMatter(raw.returns, "returns").body;
    const form = body.slice(body.indexOf("## Model withdrawal form"));
    expect(body.indexOf("## Model withdrawal form")).toBeGreaterThan(0);
    expect(form).not.toMatch(/\n## /);
    for (const name of ["{{seller.name}}", "{{seller.address}}", "{{seller.email}}"]) {
      expect(form).toContain(name);
    }
    expect(form).toMatch(/print it, or copy it into an email to \{\{seller\.email\}\}/);
  });
});
