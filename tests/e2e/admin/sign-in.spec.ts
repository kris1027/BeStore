import { expect, test } from "@playwright/test";

import { authCookieNames, createTestUser, injectSession, signInAsAdmin } from "./support";

// Spec 0004, with spec 0019: email and password only. Every test makes its own admin, so the
// tests run in parallel and on both projects.

test("a signed out visitor is sent to sign in, keeping the page asked for", async ({ page }) => {
  await page.goto("/admin/orders?status=paid");

  await expect(page).toHaveURL("/admin/sign-in?next=%2Fadmin%2Forders%3Fstatus%3Dpaid");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("the storefront sets no auth cookie", async ({ page }) => {
  await page.goto("/");

  expect(await authCookieNames(page)).toEqual([]);
});

// spec 0019, AC-1
test("an admin signs in with a password, sees their name, and signs out", async ({ page }) => {
  const admin = await createTestUser();

  await signInAsAdmin(page, admin);
  await expect(page).toHaveURL("/admin");

  await page.getByRole("button", { name: admin.name }).click();
  await expect(page.getByRole("menu")).toContainText(admin.email);
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page).toHaveURL("/admin/sign-in?reason=signed_out");
  await expect(page.getByText("You have signed out.")).toBeVisible();
  expect(await authCookieNames(page)).toEqual([]);

  await page.goBack();
  await expect(page.getByText(`Signed in as ${admin.name}`)).toHaveCount(0);
});

test("an admin returns to the page they asked for", async ({ page }) => {
  const admin = await createTestUser();

  await signInAsAdmin(page, admin, "/admin?from=link");
  await expect(page).toHaveURL("/admin?from=link");
});

test("an unsafe next falls back to /admin", async ({ page }) => {
  const admin = await createTestUser();

  await signInAsAdmin(page, admin, "//evil.example/admin");
  await expect(page).toHaveURL("/admin");
});

test.describe("failed sign in looks the same whatever the cause", () => {
  const message = "Email or password is incorrect.";

  test("wrong password, unknown email and a non admin", async ({ page }) => {
    const admin = await createTestUser();
    const customer = await createTestUser({ admin: false });

    for (const [email, password] of [
      [admin.email, "Wrong-password-1"],
      ["nobody-here@example.com", admin.password],
      [customer.email, customer.password],
    ] as const) {
      await page.goto("/admin/sign-in");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();

      await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
      await expect(page).toHaveURL("/admin/sign-in");
      expect(await authCookieNames(page)).toEqual([]);
    }
  });

  test("empty and malformed fields show field errors", async ({ page }) => {
    await page.goto("/admin/sign-in");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Enter your email address")).toBeVisible();
    await expect(page.getByText("Enter your password")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
  });
});

// spec 0019, AC-5
test("the sign in page offers no reset and ignores old reasons", async ({ page }) => {
  await page.goto("/admin/sign-in?reason=too_many_codes");

  await expect(page.getByRole("link", { name: /forgot/i })).toHaveCount(0);
  await expect(page.getByText(/reset/i)).toHaveCount(0);
  await expect(page.getByText("Too many incorrect codes", { exact: false })).toHaveCount(0);
  // Next's route announcer is an empty alert; the form notice must be empty too.
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
});

// spec 0019, AC-4
test.describe("the removed auth pages", () => {
  const removed = ["/admin/mfa", "/admin/forgot-password", "/admin/reset-password"];

  test("send a signed out visitor to sign in", async ({ page }) => {
    for (const path of removed) {
      await page.goto(path);
      await expect(page).toHaveURL(`/admin/sign-in?next=${encodeURIComponent(path)}`);
    }
  });

  test("answer an admin with a 404", async ({ page }) => {
    const admin = await createTestUser();
    await injectSession(page, admin);
    for (const path of removed) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });

  test("/auth/confirm answers 404", async ({ page }) => {
    const response = await page.goto("/auth/confirm?token_hash=abc&type=recovery");
    expect(response?.status()).toBe(404);
  });
});

// spec 0019, AC-2: an inbox alone never opens the panel.
test("an admin session opened by a recovery link is sent to sign in with a real redirect", async ({
  page,
}) => {
  const admin = await createTestUser();
  await injectSession(page, admin, "recovery");

  const response = await page.request.get("/admin/orders", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toBe("/admin/sign-in?next=%2Fadmin%2Forders");

  await page.goto("/admin");
  await expect(page).toHaveURL("/admin/sign-in?next=%2Fadmin");
  await expect(page.getByText(`Signed in as ${admin.name}`)).toHaveCount(0);

  // spec 0019, AC-6: the sign in page does not send that session on.
  await page.goto("/admin/sign-in");
  await expect(page).toHaveURL("/admin/sign-in");
});

test("a signed in admin skips the sign in page", async ({ page }) => {
  const admin = await createTestUser();
  await signInAsAdmin(page, admin);

  await page.goto("/admin/sign-in?next=%2Fadmin%2Forders");
  await expect(page).toHaveURL("/admin/orders");
});
