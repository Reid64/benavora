import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:3000/platform/prospect-intelligence", {
  waitUntil: "networkidle",
  timeout: 30000,
});
await page.screenshot({ path: "AUDIT_SCREENSHOTS/prospect-intelligence-page-mobile.png", fullPage: true });
console.log("saved");
await browser.close();
