import { chromium } from "playwright";

const OUT_DIR = "AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1500);

const el = await page.$(".bnf-fleet");
if (!el) {
  console.log("SECTION NOT FOUND: .bnf-fleet");
} else {
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200); // let entrance animation settle
  const box = await el.boundingBox();
  console.log("boundingBox", box);
  await page.screenshot({ path: `${OUT_DIR}/home__brain-network-section-crop.png`, clip: box });
  console.log("Saved fleet-section crop");
}

const stageEl = await page.$(".bnf-stage");
if (stageEl) {
  const box2 = await stageEl.boundingBox();
  console.log("stage boundingBox", box2);
  await page.screenshot({ path: `${OUT_DIR}/home__brain-network-stage-crop.png`, clip: box2 });
  console.log("Saved stage crop");
}

await browser.close();
