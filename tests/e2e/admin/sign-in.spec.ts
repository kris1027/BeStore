import { expect, test } from "@playwright/test";

import {
  authCookieNames,
  createTestUser,
  enterCode,
  signInFully,
  signInWithPassword,
  totpCode,
} from "./support";

// Spec 0004. Every test makes its own admin, so the tests run in parallel and on both projects.

test("a signed out visitor is sent to sign in, keeping the page asked for", async ({ page }) => {
  await page.goto("/admin/orders?status=paid");

  await expect(page).toHaveURL("/admin/sign-in?next=%2Fadmin%2Forders%3Fstatus%3Dpaid");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("the storefront sets no auth cookie", async ({ page }) => {
  await page.goto("/");

  expect(await authCookieNames(page)).toEqual([]);
});

test("a new admin sets up TOTP, sees their name, and signs out", async ({ page }) => {
  const admin = await createTestUser();

  await signInWithPassword(page, admin);
  await expect(page.getByRole("heading", { name: "Set up your authenticator" })).toBeVisible();
  await page.getByRole("button", { name: "Set up authenticator" }).click();

  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  const secret = (await page.locator(".font-mono").first().innerText()).replaceAll(" ", "");
  await enterCode(page, await totpCode(secret), "Verify and continue");

  await expect(page).toHaveURL("/admin");
  await expect(page.getByText(`Signed in as ${admin.name}`)).toBeVisible();

  await page.getByRole("button", { name: admin.name }).click();
  await expect(page.getByRole("menu")).toContainText(admin.email);
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page).toHaveURL("/admin/sign-in?reason=signed_out");
  await expect(page.getByText("You have signed out.")).toBeVisible();
  expect(await authCookieNames(page)).toEqual([]);

  await page.goBack();
  await expect(page.getByText(`Signed in as ${admin.name}`)).toHaveCount(0);
});

test("an enrolled admin verifies a code and returns to the page they asked for", async ({
  page,
}) => {
  const admin = await createTestUser({ enrolled: true });

  await signInWithPassword(page, admin, "/admin?from=link");
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await enterCode(page, await totpCode(admin.secret ?? ""));

  await expect(page).toHaveURL("/admin?from=link");
  await expect(page.getByText(`Signed in as ${admin.name}`)).toBeVisible();
});

test("an unsafe next falls back to /admin", async ({ page }) => {
  const admin = await createTestUser({ enrolled: true });

  await signInWithPassword(page, admin, "//evil.example/admin");
  await enterCode(page, await totpCode(admin.secret ?? ""));

  await expect(page).toHaveURL("/admin");
});

test.describe("failed sign in looks the same whatever the cause", () => {
  const message = "Email or password is incorrect.";

  test("wrong password, unknown email and a non admin", async ({ page }) => {
    const admin = await createTestUser({ enrolled: true });
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

test.describe("MFA enforcement", () => {
  test("a password only session cannot open the panel or the reset page", async ({ page }) => {
    const admin = await createTestUser({ enrolled: true });
    await signInWithPassword(page, admin);

    await page.goto("/admin");
    await expect(page).toHaveURL("/admin/mfa?next=%2Fadmin");

    await page.goto("/admin/reset-password");
    await expect(page).toHaveURL("/admin/mfa?next=%2Fadmin%2Freset-password");
  });

  test("a wrong code is refused, then the right one works", async ({ page }) => {
    const admin = await createTestUser({ enrolled: true });
    await signInWithPassword(page, admin);

    await enterCode(page, "000000");
    await expect(
      page.getByRole("alert").filter({ hasText: "That code is incorrect." }),
    ).toBeVisible();
    await expect(page.getByLabel("6 digit code")).toBeFocused();

    await enterCode(page, await totpCode(admin.secret ?? ""));
    await expect(page).toHaveURL("/admin");
  });

  test("a wrong code then a reload still enrolls with the QR code already scanned", async ({
    page,
  }) => {
    const admin = await createTestUser();
    await signInWithPassword(page, admin);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = (await page.locator(".font-mono").first().innerText()).replaceAll(" ", "");

    await enterCode(page, "000000", "Verify and continue");
    await expect(
      page.getByRole("alert").filter({ hasText: "That code is incorrect." }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Already scanned the QR code?" })).toBeVisible();
    await enterCode(page, await totpCode(secret), "Verify and continue");

    await expect(page).toHaveURL("/admin");
  });

  test("5 wrong codes lock the MFA step, even after signing in again", async ({ page }) => {
    const admin = await createTestUser({ enrolled: true });
    await signInWithPassword(page, admin);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await enterCode(page, "000000");
      await expect(
        page.getByRole("alert").filter({ hasText: "That code is incorrect." }),
      ).toBeVisible();
    }
    await enterCode(page, "000000");
    await expect(page).toHaveURL("/admin/sign-in?reason=too_many_codes");
    await expect(page.getByText("Too many incorrect codes. Please sign in again.")).toBeVisible();

    await signInWithPassword(page, admin);
    await enterCode(page, await totpCode(admin.secret ?? ""));
    await expect(page).toHaveURL("/admin/sign-in?reason=too_many_codes");
  });
});

test.describe("signed in visitors skip the auth pages", () => {
  test("at aal1 they go to the MFA step", async ({ page }) => {
    const admin = await createTestUser({ enrolled: true });
    await signInWithPassword(page, admin);

    await page.goto("/admin/sign-in");
    await expect(page).toHaveURL("/admin/mfa");
  });

  test("at aal2 they go to the panel", async ({ page }) => {
    const admin = await createTestUser({ enrolled: true });
    await signInFully(page, admin);

    await page.goto("/admin/forgot-password");
    await expect(page).toHaveURL("/admin");
  });
});
