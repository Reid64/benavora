import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);
const fullHeight = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
console.log("full page height:", fullHeight);
await page.screenshot({ path: "AUDIT_SCREENSHOTS/mkt-refresh-2026-09-06/home__midpage-crop.png", clip: { x: 0, y: Math.round(fullHeight*0.42), width: 1440, height: 550 } });
await browser.close();
