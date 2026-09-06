import { chromium } from "playwright";

const url = "http://localhost:3000/";
const outPath = "AUDIT_SCREENSHOTS/what-will-it-cost-section.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url, { waitUntil: "load", timeout: 60000 });

const section = page.locator("section.bm-cost");
await section.scrollIntoViewIfNeeded();
await section.waitFor({ state: "visible" });
await section.screenshot({ path: outPath });

console.log("Saved screenshot to", outPath);
await browser.close();
