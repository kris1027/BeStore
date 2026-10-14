import { expect, test } from "@playwright/test";

import { createTestUser } from "../admin/support";
import {
  accountLinkFor,
  choosePassword,
  customerPassword,
  orderCustomerId,
  seedPaidOrder,
  signInAsCustomer,
  signUpWithEmail,
  uniqueEmail,
} from "./support";

// spec 0012: the thin thread, sign up to the account page through every layer (AC-1, AC-2, AC-3,
// AC-8, AC-10, AC-11, AC-13).

test("a guest signs up, confirms from the email, chooses a password and sees an earlier order", async ({
  page,
  request,
}) => {
  const email = uniqueEmail();
  const earlier = await seedPaidOrder(email);

  await signUpWithEmail(page, email.toUpperCase());
  const link = await accountLinkFor(email);

  // Opening the link, as a mail scanner does, spends nothing (AC-2).
  const scanned = await request.get(link, { maxRedirects: 0 });
  expect(scanned.status()).toBe(200);
  expect(scanned.headers()["referrer-policy"]).toBe("no-referrer");

  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/account/set-password");

  // Every missing part is named (AC-3).
  await choosePassword(page, "short");
  for (const part of ["at least 8 characters", "an upper case letter", "a digit", "a symbol"]) {
    await expect(page.getByText(`Missing: ${part}`)).toBeVisible();
  }

  await choosePassword(page);
  await expect(page).toHaveURL("/account?notice=ready");
  await expect(page.getByText("Your account is ready.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(`Order #${earlier.number}`) }),
  ).toBeVisible();
  expect(await orderCustomerId(earlier.id)).not.toBeNull();

  // The link works once (AC-2).
  await page.context().clearCookies();
  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("This link has expired or was already used.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send the link again" })).toBeVisible();

  // The chosen password signs in.
  await signInAsCustomer(page, email);
  await expect(page).toHaveURL("/account");
});

test("signing up with an existing account's email gives the same answer and sends nothing", async ({
  page,
}) => {
  const existing = await createTestUser({ admin: false });

  await signUpWithEmail(page, existing.email);
  await expect(page.getByRole("button", { name: "Send the link again" })).toBeVisible();

  await page.waitForTimeout(1_500);
  const search = await fetch(
    `http://127.0.0.1:55324/api/v1/search?query=${encodeURIComponent(`to:"${existing.email}"`)}`,
  );
  expect(((await search.json()) as { messages_count: number }).messages_count).toBe(0);
});

test("a password planted before the confirm never survives it", async ({ page }) => {
  const email = uniqueEmail("planted");
  // Someone else signs up with this email straight against the Auth API, with a password they
  // know, before the owner confirms.
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password: "Planted-pass-1" }),
  });
  await signUpWithEmail(page, email);
  await page.goto(await accountLinkFor(email));
  await page.getByRole("button", { name: "Continue" }).click();
  await choosePassword(page);
  await expect(page).toHaveURL("/account?notice=ready");

  await page.context().clearCookies();
  await signInAsCustomer(page, email, "Planted-pass-1");
  await expect(page.getByText("That email and password do not match.")).toBeVisible();
  await signInAsCustomer(page, email, customerPassword);
  await expect(page).toHaveURL("/account");
});

test("a signed out visitor on an account page is sent to sign in, never from a cache", async ({
  page,
  request,
}) => {
  const redirect = await request.get("/account/orders/1001", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers()["cache-control"]).toBe("no-store");

  await page.goto("/account/orders/1001");
  await expect(page).toHaveURL("/account/sign-in?next=%2Faccount%2Forders%2F1001");
});
