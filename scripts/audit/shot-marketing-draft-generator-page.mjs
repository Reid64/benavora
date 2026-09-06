import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto("http://localhost:3000/platform/draft-generator", {
  waitUntil: "networkidle",
  timeout: 60000,
});

const heading = await page.locator("text=Stop starting every grant narrative").first();
await heading.waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(1500);

await page.screenshot({
  path: "AUDIT_SCREENSHOTS/platform-draft-generator-marketing-page-full.png",
  fullPage: true,
});
console.log("Marketing page full-page screenshot captured.");

await browser.close();
