import { expect, test } from "@playwright/test";

import { createTestUser, signInAsAdmin, testPassword } from "../admin/support";
import { seedProduct } from "../catalog/support";
import { addToCart } from "../checkout/support";
import { signInAsCustomer, uniqueEmail } from "./support";

// spec 0012: sign in, sign out and the cart merge (AC-4, AC-5, AC-6, AC-7).

const mismatch = "That email and password do not match.";

test("a wrong password, an unknown email and an unconfirmed account all get one message", async ({
  page,
}) => {
  const customer = await createTestUser({ admin: false });
  const unconfirmed = uniqueEmail("unconfirmed");
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: unconfirmed, password: testPassword }),
  });

  for (const [email, password] of [
    [customer.email, "Wrong-password-1"],
    [uniqueEmail("unknown"), testPassword],
    [unconfirmed, testPassword],
  ] as const) {
    await signInAsCustomer(page, email, password);
    await expect(page.getByRole("alert").filter({ hasText: mismatch })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  }
});

test("sign in goes to a safe next and refuses any other", async ({ page }) => {
  const customer = await createTestUser({ admin: false });

  await page.goto("/account/sign-in?next=%2F%2Fevil.example");
  await page.getByLabel("Email").fill(customer.email);
  await page.getByLabel("Password", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/account");

  // Signed in, the sign in and sign up pages send the visitor on (AC-4).
  await page.goto("/account/sign-in");
  await expect(page).toHaveURL("/account");
  await page.goto("/account/sign-up");
  await expect(page).toHaveURL("/account");

  await page.context().clearCookies();
  await page.goto("/account?page=2");
  await expect(page).toHaveURL("/account/sign-in?next=%2Faccount%3Fpage%3D2");
  await page.getByLabel("Email").fill(customer.email);
  await page.getByLabel("Password", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/account?page=2");
});

test("a signed in admin opening the customer sign in page keeps their admin session", async ({
  page,
}) => {
  const admin = await createTestUser();
  await signInAsAdmin(page, admin);

  await page.goto("/account/sign-in");
  await expect(page).toHaveURL("/account");
  await page.goto("/admin");
  await expect(page.getByText(`Signed in as ${admin.name}`)).toBeVisible();
});

test("the guest cart joins the account cart on sign in and comes back after sign out", async ({
  page,
}) => {
  const customer = await createTestUser({ admin: false });
  const socks = await seedProduct({ stock: 20, priceCents: 1500 });
  const scarf = await seedProduct({ stock: 20, priceCents: 4000, label: "Scarf" });

  // An account cart from an earlier visit.
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  await addToCart(page, socks, 2);
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Cart", exact: true })).toBeVisible();

  // Sign out replaced the account page in the history, and the account pages are never cached,
  // so nothing shows the account again without signing in.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/account$/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account\/sign-in/);

  // Shopping as a guest, then signing in, merges the two carts.
  await addToCart(page, scarf);
  await addToCart(page, socks, 1);
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("link", { name: "Cart, 4 items" })).toBeVisible();

  // Sign out forgets the cart in this browser only; the next sign in brings it back.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Cart", exact: true })).toBeVisible();
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page.getByRole("link", { name: "Cart, 4 items" })).toBeVisible();
});

// AC-7: a session that ended without our sign out (expiry, another device, an admin sign out)
// leaves the cart cookie behind; the account cart stays its customer's.
test("a leftover account cart cookie with no session shows an empty cart and starts a guest one", async ({
  page,
}) => {
  const customer = await createTestUser({ admin: false });
  const socks = await seedProduct({ stock: 20, priceCents: 1500 });
  const scarf = await seedProduct({ stock: 20, priceCents: 4000, label: "Scarf" });

  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  await addToCart(page, socks, 2);

  // The session ends, the cart cookie stays.
  await page.context().clearCookies({ name: /^sb-/ });
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();

  await addToCart(page, scarf);
  await page.goto("/cart");
  await expect(page.getByRole("link", { name: scarf.name })).toBeVisible();
  await expect(page.getByRole("link", { name: socks.name })).toHaveCount(0);

  // Signing in again brings the account cart back, with the guest line merged in.
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page.getByRole("link", { name: "Cart, 3 items" })).toBeVisible();
});
