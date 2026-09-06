import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: "tests/e2e/.auth/owner.json",
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto("http://localhost:3000/intelligence/matches", {
  waitUntil: "networkidle",
  timeout: 60000,
});

const heading = await page.locator("text=Semantic Funder Matches").first();
await heading.waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(1500);

// Try to trigger a real run so the screenshot shows actual scored results
// rather than the empty "no analysis yet" state - falls back to whatever
// real state renders if the button isn't present/enabled or the agent call
// fails, since either is still an honest representation of the live page.
const runButton = page.locator("button", { hasText: /Run Analysis|Analyzing/ }).first();
const hasButton = await runButton.count();
if (hasButton) {
  try {
    await runButton.click({ timeout: 5000 });
    // Real Claude call - agent maxDuration is 300s, give it real time.
    await page.waitForFunction(
      () => !document.body.innerText.includes("Analyzing"),
      { timeout: 120000 }
    );
    await page.waitForTimeout(1500);
  } catch (err) {
    console.log("Run Analysis click/wait did not complete cleanly:", err.message);
  }
}

await page.screenshot({
  path: "public/marketing/platform-semantic-matches-live.png",
  fullPage: false,
});
console.log("Semantic matches screenshot captured.");

await browser.close();
