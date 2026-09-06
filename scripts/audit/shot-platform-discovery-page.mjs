import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/platform/discovery", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(1000);

await page.screenshot({
  path: "AUDIT_SCREENSHOTS/platform-discovery-fullpage.png",
  fullPage: true,
});
console.log("full page screenshot done");

await page.screenshot({
  path: "AUDIT_SCREENSHOTS/platform-discovery-hero.png",
  fullPage: false,
});
console.log("hero viewport screenshot done");

await browser.close();
