import { expect, test } from "@playwright/test";

import { brand } from "../../src/lib/brand/brand";
import { expectNoA11yViolations } from "./a11y";

// The storefront's durable promises: `/` serves a titled page in the store's language, inside
// the store shell, with one main heading. The "coming soon" copy is a placeholder.
test.describe("storefront home", () => {
  test("serves / with the store title and heading", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(brand.name);
    await expect(page.getByRole("heading", { level: 1, name: brand.name })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("declares the page language for screen readers", async ({ page }) => {
    await page.goto("/");

    // tests/valid-env.ts and the CI job leave STORE_LOCALE at its default.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("renders the store shell", async ({ page }) => {
    await page.goto("/");

    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: brand.name })).toHaveAttribute("href", "/");
    const footer = page.getByRole("contentinfo");
    await expect(footer).toContainText(new RegExp(`© \\d{4} ${brand.name}`));
    // No nav links yet, so no menu button on phones either.
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);
  });

  test("shows the heading on any screen size", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: brand.name })).toBeInViewport();
  });

  test("has no axe violations", async ({ page }) => {
    await page.goto("/");

    await expectNoA11yViolations(page);
  });

  test("answers an unknown path with the branded 404", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We can't find that page");
    await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByRole("banner")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
