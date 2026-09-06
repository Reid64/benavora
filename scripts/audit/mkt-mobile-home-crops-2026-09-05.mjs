import { chromium } from "playwright";
const OUT = "AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1000);

await page.screenshot({ path: `${OUT}/home__mobile-top.png`, clip: { x: 0, y: 0, width: 390, height: 900 } });

const fleet = await page.$(".bnf-fleet");
if (fleet) {
  await fleet.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  const box = await fleet.boundingBox();
  await page.screenshot({ path: `${OUT}/home__mobile-fleet.png`, clip: box });
}
console.log("done");
await browser.close();
