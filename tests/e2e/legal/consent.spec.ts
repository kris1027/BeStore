import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "../a11y";
import { seedProduct } from "../catalog/support";
import { addToCart } from "../checkout/support";
import { blockAppScripts } from "../no-js";

// spec 0017: cookie consent. The real registry has no optional cookie, so the store never shows
// the banner; the style guide demo registry has one analytics cookie and runs the banner, the
// dialog and the withdrawal end to end (AC-15 to AC-24).

const demoCookie = "demo_analytics";

function banner(page: Page) {
  return page.getByRole("region", { name: "Cookie consent" });
}

function settingsDialog(page: Page) {
  return page.getByRole("dialog", { name: "Cookie settings" });
}

function demoState(page: Page) {
  return page.getByTestId("consent-demo-analytics");
}

async function cookieNamed(context: BrowserContext, name: string) {
  return (await context.cookies()).find((cookie) => cookie.name === name);
}

async function savedChoice(context: BrowserContext) {
  const cookie = await cookieNamed(context, "bestore_consent");
  return cookie === undefined ? undefined : JSON.parse(decodeURIComponent(cookie.value));
}

async function openDemo(page: Page) {
  await page.goto("/style-guide");
  // Ready once hydrated: the demo's state line leaves its waiting text.
  await expect(demoState(page)).not.toHaveText("Waiting for the page to load");
}

test.describe("the store", () => {
  test("never shows the banner while only necessary cookies are registered", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }),
    ).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });

  test("Cookie settings is a link in the server HTML and a dialog button after hydration", async ({
    page,
    request,
  }) => {
    const html = await (await request.get("/")).text();
    expect(html).toMatch(/<a[^>]*href="\/cookies"[^>]*>Cookie settings<\/a>/);
    expect(html).not.toContain("Cookie consent");

    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
    const dialog = settingsDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /Necessary/ })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /Necessary/ })).toBeDisabled();
    for (const name of [/Analytics/, /Marketing/]) {
      const box = dialog.getByRole("checkbox", { name });
      await expect(box).not.toBeChecked();
      await expect(box).toBeDisabled();
    }
    await expect(dialog.getByText("Not used right now")).toHaveCount(2);
    await expectNoA11yViolations(page);

    await dialog.getByRole("button", { name: "Reject all" }).click();
    await expect(dialog).toBeHidden();
    // Focus goes back to what opened it.
    await expect(
      page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }),
    ).toBeFocused();
    expect(await savedChoice(page.context())).toMatchObject({ analytics: false, marketing: false });
  });

  test("without the app's JavaScript, Cookie settings goes to the cookie policy", async ({
    page,
  }) => {
    await blockAppScripts(page);
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "Cookie settings" }).click();
    await expect(page).toHaveURL("/cookies");
    await expect(page.getByRole("table", { name: "Every cookie the store sets" })).toBeVisible();
  });

  test("/cookies lists every registered cookie and opens the settings from its own button", async ({
    page,
  }) => {
    await page.goto("/cookies");
    const table = page.getByRole("table", { name: "Every cookie the store sets" });
    for (const name of [
      "bestore_cart",
      "bestore_consent",
      /sb-<project ref>-auth-token/,
      "Stripe's own cookies",
    ]) {
      await expect(table.getByRole("cell", { name })).toBeVisible();
    }
    await page.getByRole("main").getByRole("button", { name: "Cookie settings" }).click();
    await expect(settingsDialog(page)).toBeVisible();
  });

  // AC-23: on a first visit nothing outside the necessary entries is stored, with scripts on and
  // off; only scripts could write web storage, so it is checked with them on.
  for (const scripts of ["on", "off"] as const) {
    test(`a first visit stores only necessary cookies (JavaScript ${scripts})`, async ({
      page,
    }) => {
      if (scripts === "off") await blockAppScripts(page);
      const socks = await seedProduct({ stock: 5, priceCents: 1250 });
      const necessary = /^(bestore_cart|bestore_consent|sb-.+-auth-token.*)$/;

      for (const path of ["/", `/products/${socks.slug}`, "/cart", "/checkout"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const names = (await page.context().cookies()).map((cookie) => cookie.name);
        expect(names.filter((name) => !necessary.test(name))).toEqual([]);
        if (scripts === "on") {
          expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([
            0, 0,
          ]);
        }
      }
    });
  }

  test("with a cart, checkout still stores only necessary cookies", async ({ page }) => {
    const socks = await seedProduct({ stock: 5, priceCents: 1250 });
    await addToCart(page, socks);
    await page.goto("/checkout");
    await page.waitForLoadState("networkidle");

    expect((await page.context().cookies()).map((cookie) => cookie.name)).toEqual(["bestore_cart"]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  });
});

test.describe("the style guide demo", () => {
  test("shows the banner after the skip link, with three equal buttons, and Reject all sticks", async ({
    page,
  }) => {
    await openDemo(page);
    const bar = banner(page);
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: "cookie policy" })).toHaveAttribute(
      "href",
      "/cookies",
    );
    const buttons = bar.getByRole("button");
    await expect(buttons).toHaveText(["Accept all", "Reject all", "Choose cookies"]);
    const classes = await buttons.evaluateAll((all) => all.map((button) => button.className));
    expect(new Set(classes).size).toBe(1);
    // The bar takes no focus, and comes right after the skip link in tab order.
    await expect(bar.locator(":focus")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(bar.getByRole("link", { name: "cookie policy" })).toBeFocused();
    // The page scrolls a focused element clear of the bar (WCAG 2.4.11).
    const height = await bar.evaluate((element) => element.getBoundingClientRect().height);
    const padding = await page.evaluate(() => document.documentElement.style.scrollPaddingBottom);
    expect(Number.parseFloat(padding)).toBeCloseTo(height, 0);
    await expectNoA11yViolations(page);

    await bar.getByRole("button", { name: "Reject all" }).click();
    await expect(bar).toHaveCount(0);
    expect(await savedChoice(page.context())).toMatchObject({
      v: "style-guide-demo",
      analytics: false,
      marketing: false,
    });
    expect(await page.evaluate(() => document.documentElement.style.scrollPaddingBottom)).toBe("");
    expect(await cookieNamed(page.context(), demoCookie)).toBeUndefined();

    await page.reload();
    await expect(demoState(page)).toHaveText("Off");
    await expect(banner(page)).toHaveCount(0);
  });

  test("Accept all sets the demo cookie; turning analytics off deletes it and reloads", async ({
    page,
  }) => {
    await openDemo(page);
    await banner(page).getByRole("button", { name: "Accept all" }).click();
    await expect(demoState(page)).toHaveText("On");
    await expect.poll(() => cookieNamed(page.context(), demoCookie)).toBeDefined();
    expect(await savedChoice(page.context())).toMatchObject({ analytics: true });

    await page.getByRole("button", { name: "Open cookie settings" }).click();
    const dialog = settingsDialog(page);
    await expect(dialog.getByRole("checkbox", { name: /Analytics/ })).toBeChecked();
    await expectNoA11yViolations(page);
    await dialog.getByRole("checkbox", { name: /Analytics/ }).uncheck();
    const reloaded = page.waitForEvent("load");
    await dialog.getByRole("button", { name: "Save choices" }).click();
    await reloaded;

    await expect(demoState(page)).toHaveText("Off");
    expect(await cookieNamed(page.context(), demoCookie)).toBeUndefined();
    expect(await savedChoice(page.context())).toMatchObject({ analytics: false });
  });

  test("Choose cookies opens the dialog, where a choice is saved", async ({ page }) => {
    await openDemo(page);
    await banner(page).getByRole("button", { name: "Choose cookies" }).click();
    const dialog = settingsDialog(page);
    await expect(dialog.getByRole("checkbox", { name: /Analytics/ })).not.toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /Marketing/ })).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /Analytics/ }).check();
    await dialog.getByRole("button", { name: "Save choices" }).click();

    await expect(dialog).toBeHidden();
    await expect(banner(page)).toHaveCount(0);
    await expect(demoState(page)).toHaveText("On");
  });

  test("Global Privacy Control hides the banner and refuses until the visitor opts in", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true });
    });
    await openDemo(page);

    await expect(demoState(page)).toHaveText("Off");
    await expect(banner(page)).toHaveCount(0);
    expect(await savedChoice(page.context())).toBeUndefined();

    await page.getByRole("button", { name: "Open cookie settings" }).click();
    await settingsDialog(page).getByRole("button", { name: "Accept all" }).click();
    await expect(demoState(page)).toHaveText("On");
    await page.reload();
    await expect(demoState(page)).toHaveText("On");
  });

  test("an old or broken choice counts as none, so the banner asks again", async ({ page }) => {
    await page.context().addCookies([
      {
        name: "bestore_consent",
        value: encodeURIComponent(
          JSON.stringify({
            v: "an-older-policy",
            at: Date.now(),
            analytics: true,
            marketing: false,
          }),
        ),
        url: "http://localhost:3000",
      },
    ]);
    await openDemo(page);
    await expect(banner(page)).toBeVisible();
    await expect(demoState(page)).toHaveText("Off");
  });
});
