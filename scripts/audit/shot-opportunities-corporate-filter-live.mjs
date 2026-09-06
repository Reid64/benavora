import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: "tests/e2e/.auth/owner.json",
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto("http://localhost:3000/opportunities", {
  waitUntil: "load",
  timeout: 180000,
});

const corporateChip = page.getByRole("button", { name: "Corporate", exact: true });
await corporateChip.waitFor({ state: "visible", timeout: 30000 });
await corporateChip.click();
await page.waitForTimeout(1500);

await page.screenshot({
  path: "public/marketing/platform-opportunities-corporate-filter-live.png",
  fullPage: false,
});
console.log("Opportunities corporate-filter screenshot captured.");

await browser.close();
