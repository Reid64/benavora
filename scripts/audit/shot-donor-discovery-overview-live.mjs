import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: "tests/e2e/.auth/owner.json",
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto("http://localhost:3000/donor-discovery", {
  waitUntil: "load",
  timeout: 180000,
});

const heading = page.locator("text=Donor Discovery").first();
await heading.waitFor({ state: "visible", timeout: 30000 });
await page.waitForTimeout(6000);

await page.screenshot({
  path: "public/marketing/platform-donor-discovery-live.png",
  fullPage: false,
});
console.log("Donor Discovery overview screenshot captured.");

await browser.close();
