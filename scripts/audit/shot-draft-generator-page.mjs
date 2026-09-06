import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: "tests/e2e/.auth/owner.json",
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto("http://localhost:3000/draft-generator", {
  waitUntil: "networkidle",
  timeout: 60000,
});

// Confirm we actually landed on the authenticated Draft Generator page, not a
// login redirect - a stale/expired storage state would silently produce a
// screenshot of the wrong page otherwise.
const heading = await page.locator("text=Draft Generator").first();
await heading.waitFor({ state: "visible", timeout: 15000 });
// The page shows "Loading opportunities..." until its Supabase fetch
// resolves - wait for the wizard rail (which only renders once loaded) so the
// screenshot shows the real Select Opportunity step, not a loading spinner.
const wizardRail = await page.locator("text=Grant Draft Wizard").first();
await wizardRail.waitFor({ state: "visible", timeout: 20000 });
// Let webfonts/late CSS settle - the first paint after networkidle can still
// show the nav with unstyled/overlapping link spacing.
await page.waitForTimeout(2000);

await page.screenshot({
  path: "public/marketing/platform-draft-generator-live.png",
  fullPage: false,
});
console.log("Draft Generator page screenshot captured.");

await browser.close();
