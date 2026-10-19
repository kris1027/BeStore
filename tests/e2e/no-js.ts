import type { Page } from "@playwright/test";

// spec 0016: the app's bundles never load, so React never takes over. That is the state before
// hydration, or after a failed download, and a GET form must work in it. Scripts only: a
// production build serves its CSS from chunks/ too, and an unstyled page lets fill images cover
// the controls. Streamed results still show (Next reveals them with inline scripts).
export async function blockAppScripts(page: Page) {
  await page.route(/\/_next\/static\/chunks\/.+\.js(\?|$)/, (route) => route.abort());
}
