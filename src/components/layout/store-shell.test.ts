import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { brand } = vi.hoisted(() => ({
  brand: { name: "Acme Store", contactEmail: null as string | null },
}));
vi.mock("@/lib/brand/brand", () => ({ brand }));
// The real year is an async cached component (footer-year.test.ts covers it), which the
// synchronous static renderer cannot run.
vi.mock("./footer-year", () => ({ FooterYear: () => "2026" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const { StoreShell } = await import("./store-shell");

type ShellProps = Parameters<typeof StoreShell>[0];

// createElement's types want children in props, the lint wants them as an argument.
function render(props: Omit<ShellProps, "children"> = {}) {
  return renderToStaticMarkup(createElement(StoreShell, props as ShellProps, "page body"));
}

function footer(html: string) {
  return html.slice(html.indexOf("<footer"));
}

describe("StoreShell", () => {
  beforeEach(() => {
    brand.contactEmail = null;
  });

  // covers: AC-6
  it("wraps the page in a skip link, a header and a focusable main landmark", () => {
    const html = render();

    expect(html).toContain('href="#main"');
    expect(html).toContain("Skip to content");
    expect(html).toMatch(/<main id="main" tabindex="-1"[^>]*>page body<\/main>/);
  });

  // covers: AC-6, AC-12
  it("shows the brand name from brand.name in the footer", () => {
    expect(footer(render())).toContain("Acme Store");
  });

  it("shows the year beside the brand name in the footer", () => {
    expect(footer(render())).toContain("© 2026 Acme Store");
  });

  describe("contact email", () => {
    it("is hidden when brand.contactEmail is null", () => {
      expect(footer(render())).not.toContain("mailto:");
    });

    it("shows a mailto link when brand.contactEmail is set", () => {
      brand.contactEmail = "hello@example.com";

      expect(footer(render())).toContain('href="mailto:hello@example.com"');
    });
  });

  describe("footer links", () => {
    it("renders no footer nav when there are no links", () => {
      expect(render({ footerLinks: [] })).not.toContain('aria-label="Footer"');
    });

    // spec 0017, AC-3 and AC-16: the legal pages by default, in order, then Cookie settings,
    // a plain link to /cookies with no ConsentProvider above (and in the server HTML).
    it("lists the legal pages by default, then Cookie settings", () => {
      const links = [...footer(render()).matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)</g)]
        .map((match) => [match[1], match[2]])
        .filter(([href]) => !href?.startsWith("mailto:") && href !== "/");

      expect(links).toEqual([
        ["/terms", "Terms of sale"],
        ["/privacy", "Privacy policy"],
        ["/returns", "Returns"],
        ["/shipping", "Shipping"],
        ["/cookies", "Cookie policy"],
        ["/cookies", "Cookie settings"],
      ]);
    });

    it("renders each link from the footerLinks prop in a labelled nav", () => {
      const html = render({
        footerLinks: [
          { href: "/terms", label: "Terms" },
          { href: "/privacy", label: "Privacy" },
        ],
      });

      expect(html).toContain('aria-label="Footer"');
      expect(html).toMatch(/href="\/terms"[^>]*>Terms</);
      expect(html).toMatch(/href="\/privacy"[^>]*>Privacy</);
    });
  });

  // covers: AC-6 (the menu only shows once there is something to navigate to)
  it("renders no menu button when the nav list is empty", () => {
    expect(render({ navItems: [] })).not.toContain("Open menu");
  });

  // spec 0017, AC-19: the consent bar comes right after the skip link in the DOM.
  it("places the banner right after the skip link", () => {
    const html = render({ banner: createElement("section", { "aria-label": "Cookie consent" }) });

    expect(html).toMatch(
      /Skip to content<\/a><section aria-label="Cookie consent"><\/section><header/,
    );
  });

  // spec 0017, AC-3: printing a legal page prints only its text.
  it("hides the header and the footer in print", () => {
    const html = render();

    expect(html).toMatch(/<header class="[^"]*print:hidden/);
    expect(html).toMatch(/<footer class="[^"]*print:hidden/);
  });

  it("renders header actions from the actions prop", () => {
    const html = render({ actions: createElement("button", { type: "button" }, "Cart") });

    expect(html).toContain(">Cart</button>");
  });
});
