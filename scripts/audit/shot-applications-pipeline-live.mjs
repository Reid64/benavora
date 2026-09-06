import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: "tests/e2e/.auth/owner.json",
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto("http://localhost:3000/applications", {
  waitUntil: "load",
  timeout: 180000,
});

const heading = page.locator("text=Applications").first();
await heading.waitFor({ state: "visible", timeout: 30000 });
await page.waitForTimeout(2000);

await page.screenshot({
  path: "public/marketing/platform-applications-pipeline-live.png",
  fullPage: false,
});
console.log("Applications pipeline screenshot captured.");

await browser.close();
