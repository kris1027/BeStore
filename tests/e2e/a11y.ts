import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// WCAG 2.2 AA (spec 0003, AC-9). axe finds a third to half of real issues; keyboard tests and
// a human screen reader pass cover the rest.
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoA11yViolations(page: Page) {
  // A Sheet or Dialog mid fade has partly transparent text, which axe reports as low contrast.
  // Spinners loop forever, so only finite animations are awaited.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  const summary = violations.map((v) => ({
    id: v.id,
    help: v.help,
    targets: v.nodes.map((node) => node.target.join(" ")),
  }));
  expect(summary).toEqual([]);
}
