import { expect, test } from "@playwright/test";

// The scaffold's durable promises: `/` boots and serves a titled, English page with one main heading.
// The "coming soon" copy is a placeholder, so it is deliberately not asserted.
test.describe("storefront home", () => {
  test("serves / with the store title and heading", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("BeStore");
    await expect(page.getByRole("heading", { level: 1, name: "BeStore" })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("declares the page language for screen readers", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("shows the heading on a phone sized screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "BeStore" })).toBeInViewport();
  });

  test("answers an unknown path with 404", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");

    expect(response?.status()).toBe(404);
  });
});
