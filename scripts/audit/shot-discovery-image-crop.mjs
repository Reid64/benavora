import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:3000/platform/discovery", {
  waitUntil: "networkidle",
  timeout: 60000,
});
const img = page.locator("img[alt*='Research Command Center']");
await img.scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
await img.screenshot({ path: "AUDIT_SCREENSHOTS/platform-discovery-image-crop-mobile.png" });
console.log("crop done");
await browser.close();
