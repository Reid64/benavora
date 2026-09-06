import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:3000/platform/discovery", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(1000);
await page.screenshot({
  path: "AUDIT_SCREENSHOTS/platform-discovery-mobile-fullpage.png",
  fullPage: true,
});
console.log("mobile screenshot done");
await browser.close();
