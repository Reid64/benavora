import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: "tests/e2e/.auth/owner.json",
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto("http://localhost:3000/research/match", {
  waitUntil: "networkidle",
  timeout: 60000,
});

const heading = await page.locator("text=Funder Matching").first();
await heading.waitFor({ state: "visible", timeout: 15000 });

// Fill in a real mission statement and submit so the screenshot shows actual
// ranked results against the live foundation_directory table, not the blank
// pre-search state.
await page.fill(
  "textarea",
  "We provide emergency housing, case management, and workforce training for veterans and their families experiencing homelessness."
);
await page.click('button[type="submit"]');
await page.waitForTimeout(4000);

await page.screenshot({
  path: "public/marketing/platform-funder-matching-live.png",
  fullPage: false,
});
console.log("Funder matching screenshot captured.");

await browser.close();
