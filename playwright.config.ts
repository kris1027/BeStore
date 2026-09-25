import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Phone layouts (the mobile nav Sheet, the off canvas admin sidebar) only exist below md.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // CI tests what ships: a production build. Locally the dev server is faster to iterate on.
  webServer: isCI
    ? {
        command: "pnpm build && pnpm start",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 300_000,
      }
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
      },
});
