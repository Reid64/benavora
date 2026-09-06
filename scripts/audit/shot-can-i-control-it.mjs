import { chromium } from "playwright";

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  const section = page.locator("section#control-title, section:has(#control-title)").first();
  const heading = page.locator("#control-title");
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await section.screenshot({ path: "AUDIT_SCREENSHOTS/can-i-control-it-section.png" });
  await page.screenshot({ path: "AUDIT_SCREENSHOTS/can-i-control-it-fullpage.png", fullPage: true });
  await browser.close();
  console.log("done");
};

run();
