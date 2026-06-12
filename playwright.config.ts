import { defineConfig, devices } from "@playwright/test";

// Kept in sync with STORAGE_STATE in ./tests/e2e/helpers.ts. Inlined here so the
// `tsc --noEmit` gate (which excludes tests/) does not pull test code into the
// type program via this config import.
const STORAGE_STATE = "tests/e2e/.auth/owner.json";

/**
 * Playwright configuration for Benavora E2E tests.
 *
 * Tests live in ./tests. The dev server is started automatically.
 *
 * Projects:
 *   - setup:  authenticates the dedicated test owner and seeds a minimal real
 *             dataset, then saves the browser storage state.
 *   - public: unauthenticated flows (landing, login, registration). No session.
 *   - authed: everything behind the dashboard. Depends on "setup" and reuses
 *             the saved storage state so each test starts signed in.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  // The dev server compiles routes on demand, so the first visit to a page (and
  // its API route) can take several seconds — longer than the 5s default
  // web-first assertion timeout under parallel load. Give assertions room so
  // cold-compiled detail pages (automation session, campaign) settle before we
  // assert on them.
  expect: { timeout: 15000 },
  // Ensures the Chromium binary is downloaded before any project launches a
  // browser. Without it a fresh checkout fails with "Executable doesn't exist"
  // because installing the npm packages does not fetch browser binaries.
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: "e2e/auth.setup.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "public",
      testMatch: ["smoke.spec.ts", "e2e/public/**/*.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "authed",
      testMatch: "e2e/authed/**/*.spec.ts",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
