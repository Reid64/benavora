import { defineConfig, devices } from "@playwright/test";

/**
 * Dedicated config for the production audit chunks under tests/e2e/audit/.
 * Deliberately separate from playwright.config.ts:
 *   - No webServer block. These specs run against real production
 *     (https://www.benavora.com), never a local dev server.
 *   - workers=1 / fullyParallel=false. Several audit tests build a disposable
 *     record in one test and reuse it in later tests within the same file
 *     (serial dependency), and several trigger real AI-agent API calls that
 *     should not be hammered concurrently against a live account.
 *   - Long timeouts. Some "Run X" buttons trigger real Claude/external-API
 *     agent calls that can legitimately take well over the default 30s.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "tests/e2e/audit/**/*.spec.ts",
  testIgnore: ["**/.claude/**", "**/node_modules/**"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // Generous per-test ceiling: each test groups many element checks behind
  // one login/page session, and several routes (per PLATFORM_INVENTORY.md's
  // API audit) run real synchronous agent work server-side that can take a
  // couple of minutes even when working correctly. clickAndConfirmRealCall()
  // in the spec caps its own per-element waits well below this, so this is a
  // safety ceiling, not the expected runtime.
  timeout: 25 * 60 * 1000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "tests/e2e/audit/chunk-a-playwright-report.json" }],
  ],
  use: {
    baseURL: "https://www.benavora.com",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // Shorter than the 30s+ default so a genuinely-blocked element (e.g. an
    // overlapping div intercepting pointer events) fails fast instead of
    // burning 20-30s of retries per element across ~90 elements.
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "audit",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
