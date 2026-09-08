import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const EMAIL = "owner.e2e@benavora-test.dev";
const PASSWORD = "Benavora!E2E-Test-1";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load" });
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });

  await page.goto(`${BASE_URL}/intelligence/990-funding-pattern-explorer`, {
    waitUntil: "load",
  });
  await page.waitForTimeout(3000);

  // Click the "Contributions Paid" node circle by its accessible title
  const node = page.locator("circle", { hasText: "" }).and(page.locator(":has(title:text('Contributions Paid'))"));
  await node.first().click({ force: true });
  await page.waitForTimeout(500);

  const panelText = await page.locator("text=Click a node or connection").isVisible().catch(() => true);
  const detailVisible = await page.getByText("A real aggregate filing total").isVisible().catch(() => false);

  await page.screenshot({ path: "scripts/audit/990-explorer-after-click.png", fullPage: true });

  console.log("=== EMPTY_PANEL_STILL_SHOWING (should be false after click) ===", panelText);
  console.log("=== NODE_DETAIL_PANEL_VISIBLE (should be true) ===", detailVisible);

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
