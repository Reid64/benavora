import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 60000 });

await page.screenshot({ path: "test-evidence/marketing/mkt-outcome-section/home-full.png", fullPage: true });

const heading = page.locator("#outcome-title");
await heading.scrollIntoViewIfNeeded();
const section = page.locator("section:has(#outcome-title)").first();
await section.screenshot({ path: "test-evidence/marketing/mkt-outcome-section/section-only.png" });

console.log("done");
await browser.close();
