import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { env, brand } = vi.hoisted(() => ({
  env: { STORE_TIMEZONE: "UTC" },
  brand: { name: "Acme Store", contactEmail: null as string | null },
}));
vi.mock("@/lib/env", () => ({ env }));
vi.mock("@/lib/brand/brand", () => ({ brand }));
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
    env.STORE_TIMEZONE = "UTC";
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

  describe("footer year", () => {
    // 11:00 UTC on New Year's Eve is already 01:00 on 1 January in Kiritimati (UTC+14).
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-12-31T11:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("uses the store's year, not UTC's, when the store is ahead", () => {
      env.STORE_TIMEZONE = "Pacific/Kiritimati";

      expect(footer(render())).toContain("© 2027 Acme Store");
    });

    it("uses the UTC year for a UTC store at the same instant", () => {
      expect(footer(render())).toContain("© 2026 Acme Store");
    });

    it("uses the store's year when the store is behind UTC", () => {
      env.STORE_TIMEZONE = "Pacific/Pago_Pago";
      vi.setSystemTime(new Date("2027-01-01T05:00:00Z"));

      expect(footer(render())).toContain("© 2026 Acme Store");
    });
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
      expect(render()).not.toContain('aria-label="Footer"');
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

  it("renders header actions from the actions prop", () => {
    const html = render({ actions: createElement("button", { type: "button" }, "Cart") });

    expect(html).toContain(">Cart</button>");
  });
});
