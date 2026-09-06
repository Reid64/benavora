import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3100/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2000);
const el = await page.$(".bm-cost");
if (!el) {
  console.log("NOT FOUND: .bm-cost section does not exist in rendered DOM");
} else {
  const box = await el.boundingBox();
  console.log("bm-cost box:", JSON.stringify(box));
  const text = await el.innerText();
  console.log("--- text ---");
  console.log(text);
  await el.screenshot({ path: "AUDIT_SCREENSHOTS/mkt-refresh-2026-09-06/home__cost-section-crop.png" });
}
await browser.close();
