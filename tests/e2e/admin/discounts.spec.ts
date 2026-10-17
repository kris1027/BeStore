import { randomUUID } from "node:crypto";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { seedProduct } from "../catalog/support";
import { seedCode, seedPaidOrderWithCode } from "../checkout/support";
import { createTestUser, disableAdmin, injectSession, signInFully } from "./support";

// spec 0014, AC-10 to AC-14, AC-17 and AC-20: the promo code admin. Codes are shared by every
// spec running at the same time, so each test searches for its own unique code.

async function signedInAdmin(browser: Browser): Promise<Page> {
  const admin = await createTestUser({ enrolled: true });
  const page = await (await browser.newContext()).newPage();
  await signInFully(page, admin);
  return page;
}

async function openNewCode(page: Page) {
  await page.goto("/admin/discounts/new");
  await expect(page.getByRole("button", { name: "Add code" })).toBeEnabled();
}

test("an admin creates a code, finds it in the list, edits it and deletes it", async ({
  browser,
}, testInfo) => {
  const page = await signedInAdmin(browser);
  const code = `E2E-${randomUUID().slice(0, 8).toUpperCase()}`;

  if (testInfo.project.name === "desktop") {
    // The nav entry (on a phone it sits in the off canvas sidebar).
    await page.goto("/admin");
    await page.getByRole("link", { name: "Discounts" }).click();
  } else {
    await page.goto("/admin/discounts");
  }
  await expect(page.getByRole("heading", { level: 1, name: "Discounts" })).toBeVisible();
  await page.getByRole("link", { name: "New code" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "New code" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add code" })).toBeEnabled();

  // Nothing filled: each field says what is missing, and the first takes focus.
  await page.getByRole("button", { name: "Add code" }).click();
  await expect(page.getByText("Enter a code.")).toBeVisible();
  await expect(page.getByText("Choose a type.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Code", exact: true })).toBeFocused();
  await expectNoA11yViolations(page);

  await page.getByRole("textbox", { name: "Code", exact: true }).fill(code.toLowerCase());
  await page.getByRole("radio", { name: "Percent off the items" }).check();
  await page.getByLabel("Percent off", { exact: true }).fill("15");
  await page.getByLabel("Total use limit (optional)").fill("5");
  await page.getByLabel("Ends at (optional)").fill("2099-12-31T23:30");
  await page.getByRole("button", { name: "Add code" }).click();

  await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible();
  await expect(page.getByLabel("Ends at (optional)")).toHaveValue("2099-12-31T23:30");
  await expectNoA11yViolations(page);

  // A second code with the same text is refused on the Code field.
  await openNewCode(page);
  await page.getByRole("textbox", { name: "Code", exact: true }).fill(code);
  await page.getByRole("radio", { name: "Fixed amount off the items" }).check();
  await page.getByLabel("Amount off (EUR)").fill("5");
  await page.getByRole("button", { name: "Add code" }).click();
  await expect(page.getByText("A code with this name already exists.")).toBeVisible();

  await page.goto(`/admin/discounts?q=${code}`);
  const row = page.getByRole("row", { name: new RegExp(code) });
  await expect(row).toContainText("15%");
  await expect(row).toContainText("Active");
  await expect(row).toContainText("0 / 5");
  await expect(row).toContainText("€0.00");
  await expectNoA11yViolations(page);

  await row.getByRole("link", { name: code, exact: true }).click();
  await expect(page.getByRole("button", { name: "Save code" })).toBeEnabled();
  await page.getByRole("checkbox", { name: "Active" }).uncheck();
  await page.getByRole("button", { name: "Save code" }).click();
  await expect(page.getByText("Code saved")).toBeVisible();
  await page.goto(`/admin/discounts?q=${code}&status=inactive`);
  await expect(page.getByRole("row", { name: new RegExp(code) })).toContainText("Inactive");

  await page.getByRole("link", { name: code, exact: true }).click();
  await page.getByRole("button", { name: "Delete code" }).click();
  await expect(page.getByRole("dialog", { name: `Delete ${code}?` })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("dialog").getByRole("button", { name: "Delete code" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Discounts" })).toBeVisible();
  await page.goto(`/admin/discounts?q=${code}`);
  await expect(page.getByRole("heading", { name: "No codes match these filters." })).toBeVisible();
});

test("a used code locks its code, type and value, and links to the orders that used it", async ({
  browser,
}) => {
  const page = await signedInAdmin(browser);
  const product = await seedProduct({ stock: 5, priceCents: 4000 });
  const code = await seedCode({ value: 25, maxRedemptions: 1 });
  const order = await seedPaidOrderWithCode(product, code, {
    priceCents: 4000,
    discountCents: 1000,
  });

  await page.goto(`/admin/discounts/${code.id}`);
  await expect(page.getByRole("heading", { level: 1, name: code.code })).toBeVisible();
  await expect(page.getByText("Used up")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Code", exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(page.getByLabel("Percent off", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByText("Locked after first use.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete code" })).toHaveCount(0);
  await expect(page.getByText("€10.00")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("link", { name: "Orders with this code" }).click();
  await expect(page).toHaveURL(`/admin/orders?discount=${code.id}`);
  await expect(page.getByRole("row", { name: new RegExp(`#${order.number}`) })).toBeVisible();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  const chip = page.getByRole("link", { name: `Remove the promo code filter ${code.code}` });
  await expect(chip).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto(`/admin/orders/${order.number}`);
  await expect(page.getByRole("link", { name: `${code.code}, 25%` })).toHaveAttribute(
    "href",
    `/admin/discounts/${code.id}`,
  );
});

test("the code form works by keyboard alone", async ({ browser }) => {
  const page = await signedInAdmin(browser);
  const code = `E2E-${randomUUID().slice(0, 8).toUpperCase()}`;
  await openNewCode(page);

  await tabTo(page, page.getByRole("textbox", { name: "Code", exact: true }));
  await page.keyboard.type(code);
  await page.keyboard.press("Tab");
  // The radio group takes one Tab stop; Space picks the focused option.
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { name: "Percent off the items" })).toBeChecked();
  await tabTo(page, page.getByLabel("Percent off", { exact: true }));
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible();
});

test("a signed in non admin gets a 404 on every discount page, and a signed out visitor signs in", async ({
  page,
}) => {
  const customer = await createTestUser({ admin: false });
  await injectSession(page, customer);
  for (const path of [
    "/admin/discounts",
    "/admin/discounts/new",
    "/admin/discounts/01890000-0000-7000-8000-000000000000",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  }

  const visitor = await (await page.context().browser()!.newContext()).newPage();
  await visitor.goto("/admin/discounts");
  await expect(visitor).toHaveURL(/\/admin\/sign-in/);
});

test("a disabled admin's code save changes nothing", async ({ browser }) => {
  const admin = await createTestUser({ enrolled: true });
  const page = await (await browser.newContext()).newPage();
  await signInFully(page, admin);
  await openNewCode(page);

  await disableAdmin(admin.id);
  await page
    .getByRole("textbox", { name: "Code", exact: true })
    .fill(`E2E-${randomUUID().slice(0, 8)}`);
  await page.getByRole("radio", { name: "Percent off the items" }).check();
  await page.getByLabel("Percent off", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Add code" }).click();

  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
});
