import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./a11y";

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

// Tab and Enter behave the same on the phone project, which emulates touch but still has a keyboard.
test.describe("style guide", () => {
  test("renders every component section and tells robots to stay out", async ({ page }) => {
    const response = await page.goto("/style-guide");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/^Style guide · /);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Style guide");
    for (const name of [
      "Colors",
      "Contrast",
      "Typography",
      "Layout, radius and images",
      "Money",
      "Components",
      "Button",
      "Input, Textarea, Select and Field",
      "Checkbox and Radio group",
      "Card",
      "Badge",
      "Alert",
      "Dialog and Sheet",
      "Dropdown menu",
      "Toast",
      "Table",
      "Skeleton, Spinner, Empty and Separator",
    ]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
  });

  test("formats prices in the store's locale and currency", async ({ page }) => {
    await page.goto("/style-guide");

    const money = page.locator("#money");
    await expect(money).toContainText("€19.99");
    await expect(money).toContainText("¥1,999");
    await expect(money).toContainText("-€5.00");
    await expect(money).toContainText(/12\s345,67\szł/);
  });

  test("has no axe violations", async ({ page }) => {
    await page.goto("/style-guide");

    await expectNoA11yViolations(page);
  });

  test("has no axe violations with a Dialog open", async ({ page }) => {
    await page.goto("/style-guide");
    await page.getByRole("button", { name: "Open dialog" }).click();
    await expect(page.getByRole("dialog", { name: "Remove this item?" })).toBeVisible();

    await expectNoA11yViolations(page);
  });

  test("has no axe violations with a Select open", async ({ page }) => {
    await page.goto("/style-guide");
    await page.getByRole("combobox", { name: "Size", exact: true }).click();
    await expect(page.getByRole("option", { name: "Medium" })).toBeVisible();

    await expectNoA11yViolations(page);
  });

  test("announces a toast", async ({ page }) => {
    await page.goto("/style-guide");
    await page.getByRole("button", { name: "Show success toast" }).click();

    await expect(page.getByText("Added to cart")).toBeVisible();
  });
});

test.describe("keyboard", () => {
  test("the skip link is the first tab stop and moves focus to main", async ({ page }) => {
    await page.goto("/style-guide");

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("every focused element shows the 2px ring and is never under the sticky header", async ({
    page,
  }) => {
    await page.goto("/style-guide");
    const headerBottom = await page
      .getByRole("banner")
      .evaluate((header) => header.getBoundingClientRect().bottom);

    const check = async () => {
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        return {
          name: el.outerHTML.slice(0, 80),
          // The header and fixed elements (the skip link) cannot sit under the header.
          inHeader: Boolean(el.closest("header")) || getComputedStyle(el).position === "fixed",
          top: el.getBoundingClientRect().top,
        };
      });
      if (!focus) return;
      // Polled: `transition-all` on buttons eases the outline in from its 3px initial width.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const style = getComputedStyle(document.activeElement as HTMLElement);
              return `${style.outlineStyle} ${style.outlineWidth}`;
            }),
          { message: focus.name },
        )
        .toBe("solid 2px");
      if (!focus.inHeader) expect(focus.top, focus.name).toBeGreaterThanOrEqual(headerBottom - 1);
    };

    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      await check();
    }
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Shift+Tab");
      await check();
    }
  });

  test("a Dialog traps focus, closes on Escape and returns focus", async ({ page }) => {
    await page.goto("/style-guide");
    const trigger = page.getByRole("button", { name: "Open dialog" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Remove this item?" });
    await expect(dialog).toBeVisible();

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      // Base UI moves focus off its edge guards a tick after Tab, so poll.
      await expect
        .poll(() => dialog.evaluate((d) => d.contains(document.activeElement)))
        .toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("storefront mobile menu", () => {
  test("opens by keyboard, traps focus, closes on Escape and returns focus", async ({ page }) => {
    test.skip(!isPhone(page), "The menu button only exists below md");
    await page.goto("/style-guide");

    const button = page.getByRole("button", { name: "Open menu" });
    await button.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Admin shell" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Style guide" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      await expect.poll(() => sheet.evaluate((s) => s.contains(document.activeElement))).toBe(true);
    }

    await expectNoA11yViolations(page);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("shows the nav inline on desktop instead", async ({ page }) => {
    test.skip(isPhone(page), "Desktop layout only");
    await page.goto("/style-guide");

    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin shell" }),
    ).toBeVisible();
  });
});

test.describe("admin shell", () => {
  test("marks the current section and has no axe violations", async ({ page }) => {
    await page.goto("/style-guide/admin");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
    await expect(page.getByText("Admin", { exact: true })).toBeVisible();
    if (isPhone(page)) {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    }
    const nav = page.getByRole("navigation", { name: "Admin" });
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Orders" })).not.toHaveAttribute(
      "aria-current",
      /.*/,
    );

    await expectNoA11yViolations(page);
  });

  test("the phone sidebar is an off canvas sheet that returns focus on Escape", async ({
    page,
  }) => {
    test.skip(!isPhone(page), "Off canvas only below md");
    await page.goto("/style-guide/admin");

    const trigger = page.getByRole("button", { name: "Toggle Sidebar" });
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeHidden();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the desktop sidebar collapses and expands", async ({ page }) => {
    test.skip(isPhone(page), "Desktop layout only");
    await page.goto("/style-guide/admin");

    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar).toHaveAttribute("data-state", "expanded");
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });
});

test.describe("error page", () => {
  test("shows a plain message with Try again and no error details", async ({ page }) => {
    await page.goto("/style-guide/throw");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Something went wrong");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the home page" })).toBeVisible();
    // Scoped to main: in dev the Next.js overlay shows the message to the developer.
    await expect(page.locator("main")).not.toContainText("must never reach the page");
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("overlays appear without a transition", async ({ page }) => {
    await page.goto("/style-guide");
    await page.getByRole("button", { name: "Open sheet" }).click();
    const sheet = page.getByRole("dialog", { name: "Your cart" });
    await expect(sheet).toBeVisible();

    const duration = await sheet.evaluate((el) =>
      Math.max(
        ...getComputedStyle(el)
          .transitionDuration.split(",")
          .map((d) => parseFloat(d)),
      ),
    );
    expect(duration).toBeLessThanOrEqual(0.00001);
  });
});
