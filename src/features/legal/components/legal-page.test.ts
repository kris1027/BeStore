import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { calendarDate, formatCalendarDate } from "@/lib/dates";
import cookiesText from "@/lib/legal/content/cookies.md";
import termsText from "@/lib/legal/content/terms.md";
import { parseFrontMatter } from "@/lib/legal/front-matter";
import { legalSlugs } from "@/lib/legal/paths";

vi.mock("server-only", () => ({}));
// Another origin and another locale than the defaults, so the test proves both follow the env.
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SITE_URL: "https://staging.other.example",
    STORE_LOCALE: "pl-PL",
    STORE_COUNTRY: "PL",
    STORE_CURRENCY: "PLN",
    VERCEL_ENV: "development",
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { LegalPage, legalMetadata } = await import("./legal-page");
const { cookiePolicyVersion, currentTermsVersion } = await import("@/lib/legal/documents");

// spec 0017, Value sourcing: front matter. The checkout's version and the consent cookie's `v`
// come from the files' own `updated` date, so editing it moves them with no other change.
describe("the text versions", () => {
  it("take the terms version from terms.md front matter", () => {
    expect(currentTermsVersion).toBe(parseFrontMatter(termsText, "terms").meta.updated);
  });

  it("take the cookie policy version from cookies.md front matter", () => {
    expect(cookiePolicyVersion).toBe(parseFrontMatter(cookiesText, "cookies").meta.updated);
  });
});

// spec 0017, AC-2 and Value sourcing: canonical.
describe("legalMetadata", () => {
  it.each(legalSlugs)("points the %s canonical URL at NEXT_PUBLIC_SITE_URL", (slug) => {
    expect(legalMetadata(slug).alternates?.canonical).toBe(`https://staging.other.example/${slug}`);
  });

  it("uses the front matter title and description", () => {
    const { meta } = parseFrontMatter(termsText, "terms");

    expect(legalMetadata("terms")).toMatchObject({
      title: meta.title,
      description: meta.description,
    });
  });
});

// spec 0017, AC-1 and Value sourcing: calendar dates.
describe("LegalPage", () => {
  const html = renderToStaticMarkup(createElement(LegalPage, { slug: "terms" }));
  const updated = parseFrontMatter(termsText, "terms").meta.updated;

  it("shows the version date in STORE_LOCALE, on the file's own day", () => {
    const polish = formatCalendarDate(calendarDate(updated), "pl-PL");

    expect(polish).not.toBe(formatCalendarDate(calendarDate(updated), "en"));
    expect(html).toContain(`Last updated <time dateTime="${updated}">${polish}</time>`);
  });

  it("has the title as its only h1 and no unfilled placeholder", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(">Terms of sale</h1>");
    expect(html).not.toContain("{{");
  });

  it("fills the live values a page passes in", () => {
    const shipping = renderToStaticMarkup(
      createElement(LegalPage, {
        slug: "shipping",
        values: { deliveryFee: "9,99 zł", freeDeliveryRule: "Free over 50 zł." },
      }),
    );

    expect(shipping).toContain("9,99 zł");
    expect(shipping).toContain("Free over 50 zł.");
    expect(shipping).not.toContain("{{");
  });
});
