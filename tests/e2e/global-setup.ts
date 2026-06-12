import { execSync } from "node:child_process";

import { chromium } from "@playwright/test";

/**
 * Global setup: guarantee the Chromium binary Playwright launches actually
 * exists before any project runs.
 *
 * A fresh checkout (or CI image) installs the `@playwright/test` package but
 * NOT the browser binaries — those are downloaded separately by
 * `playwright install`. Without them, every test fails at launch with
 *   "browserType.launch: Executable doesn't exist at ...chrome-headless-shell"
 * which is exactly how this suite first failed.
 *
 * We probe by attempting a real launch (the most reliable check, since it
 * exercises the same path the projects use). If that throws, we download
 * Chromium once. This makes `npx playwright test` self-provisioning so the
 * quality gate passes on a clean machine.
 */
async function globalSetup(): Promise<void> {
  try {
    const browser = await chromium.launch();
    await browser.close();
    return; // Browser already present — nothing to do.
  } catch {
    // Fall through and install.
  }

  // eslint-disable-next-line no-console
  console.log("[global-setup] Chromium not found — running `playwright install chromium`...");
  execSync("npx playwright install chromium", { stdio: "inherit" });
}

export default globalSetup;
