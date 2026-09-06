import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: "tests/e2e/.auth/owner.json",
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto("http://localhost:3000/dashboard", {
  waitUntil: "networkidle",
  timeout: 60000,
});

// Confirm we actually landed on the authenticated Dashboard, not a login
// redirect - a stale/expired storage state would silently produce a
// screenshot of the wrong page otherwise.
const actionQueue = await page.locator("text=Action Queue").first();
await actionQueue.waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(2000);

await page.screenshot({
  path: "public/marketing/platform-dashboard-overview-live.png",
  fullPage: false,
});
console.log("Dashboard overview screenshot captured.");

await browser.close();
