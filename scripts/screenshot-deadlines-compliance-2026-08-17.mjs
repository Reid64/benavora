import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 30000 });
  await page.fill("#email", "info@faithfoundationsf.org");
  await page.fill("#password", "Fasterman1945#@#");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  await page.goto(`${BASE_URL}/deadlines`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.click('button:has-text("Compliance")');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "smoke-test-output/deadlines-compliance-loaded.png", fullPage: true });
  console.log("saved");
  await browser.close();
}
main();
