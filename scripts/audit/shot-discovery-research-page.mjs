import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: "tests/e2e/.auth/owner.json",
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto("http://localhost:3000/research", {
  waitUntil: "networkidle",
  timeout: 60000,
});

// Confirm we actually landed on the authenticated Research page, not a login
// redirect - a stale/expired storage state would silently produce a screenshot
// of the wrong page otherwise.
const heading = await page.locator("text=Research Command Center").first();
await heading.waitFor({ state: "visible", timeout: 15000 });
// Let webfonts/late CSS settle - the first paint after networkidle can still
// show the nav with unstyled/overlapping link spacing.
await page.waitForTimeout(2000);

await page.screenshot({
  path: "public/marketing/platform-discovery-research-live.png",
  fullPage: false,
});
console.log("Research page screenshot captured.");

await browser.close();
