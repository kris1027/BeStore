import { expect, type Page, test } from "@playwright/test";

import { type SeededProduct, seedProduct, setProductStatus, setStock } from "./support";

// Spec 0005, milestone 4: the full cart, its flags, the header count and the checkout stub.

async function addToCart(page: Page, product: SeededProduct, quantity = 1) {
  await page.goto(`/products/${product.slug}`);
  await page.getByLabel("Quantity").fill(String(quantity));
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();
}

const quantityOf = (page: Page, name: string) =>
  page.getByRole("group", { name: `Quantity of ${name}` }).locator("output");

test("quantity changes and removals persist, and the header counts the items", async ({ page }) => {
  const socks = await seedProduct({ stock: 20, priceCents: 1500 });
  const scarf = await seedProduct({ stock: 20, priceCents: 4000, label: "Scarf" });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Cart", exact: true })).toBeVisible();

  await addToCart(page, socks, 2);
  await addToCart(page, scarf);
  await expect(page.getByRole("link", { name: "Cart, 3 items" })).toBeVisible();

  await page.goto("/cart");
  await page.getByRole("button", { name: `Increase quantity of ${socks.name}` }).click();
  await expect(quantityOf(page, socks.name)).toHaveText("3");
  await expect(page.getByRole("link", { name: "Cart, 4 items" })).toBeVisible();

  await page.getByRole("button", { name: `Remove ${scarf.name}` }).click();
  await expect(page.getByText("Removed from cart")).toBeVisible();
  await expect(page.getByRole("link", { name: scarf.name })).toHaveCount(0);

  await page.reload();
  await expect(quantityOf(page, socks.name)).toHaveText("3");
  await expect(page.getByRole("link", { name: scarf.name })).toHaveCount(0);
  await expect(page.getByText("€45.00").first()).toBeVisible();

  await page.getByRole("button", { name: `Remove ${socks.name}` }).click();
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cart", exact: true })).toBeVisible();
});

test("checkout shows the order from live prices and a payment notice", async ({ page }) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks, 2);

  await page.goto("/cart");
  await page.getByRole("link", { name: "Checkout" }).click();
  await expect(page).toHaveURL("/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await expect(page.getByText("2 × €12.50")).toBeVisible();
  await expect(page.getByText("Payment comes next")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("stale lines are flagged, block checkout, and each has a one click fix", async ({ page }) => {
  const low = await seedProduct({ stock: 6, label: "Low" });
  const gone = await seedProduct({ stock: 6, label: "Gone" });
  const hidden = await seedProduct({ stock: 6, label: "Hidden" });
  await addToCart(page, low, 5);
  await addToCart(page, gone);
  await addToCart(page, hidden);

  await setStock(low.variantId, 2);
  await setStock(gone.variantId, 0);
  await setProductStatus(hidden.id, "draft");

  await page.goto("/cart");
  await expect(page.getByText("Only 2 left")).toBeVisible();
  await expect(page.getByText("Sold out")).toBeVisible();
  await expect(page.getByText("No longer available")).toBeVisible();
  await expect(page.getByRole("button", { name: "Checkout" })).toBeDisabled();
  await expect(page.getByText("Some items need your attention.")).toBeVisible();

  // Checkout rereads the cart and sends the customer back.
  await page.goto("/checkout");
  await expect(page).toHaveURL("/cart");

  await page.getByRole("button", { name: "Set to 2" }).click();
  await expect(quantityOf(page, low.name)).toHaveText("2");
  await page.getByRole("button", { name: `Remove ${gone.name}` }).click();
  await expect(page.getByRole("link", { name: gone.name })).toHaveCount(0);
  await page.getByRole("button", { name: `Remove ${hidden.name}` }).click();
  await expect(page.getByRole("link", { name: hidden.name })).toHaveCount(0);

  await expect(page.getByRole("link", { name: "Checkout" })).toBeVisible();
});

test("the cart and checkout tell robots to stay out, and an empty cart cannot check out", async ({
  page,
}) => {
  await page.goto("/checkout");
  await expect(page).toHaveURL("/cart");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
