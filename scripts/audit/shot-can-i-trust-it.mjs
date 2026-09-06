import { chromium } from "playwright";

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  const section = page.locator("section#trustit-title, section:has(#trustit-title)").first();
  const heading = page.locator("#trustit-title");
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await section.screenshot({ path: "AUDIT_SCREENSHOTS/can-i-trust-it-section.png" });
  await browser.close();
  console.log("done");
};

run();
