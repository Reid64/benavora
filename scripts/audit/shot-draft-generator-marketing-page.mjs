// One-off evidence capture for the new /platform/draft-generator marketing
// page. Confirms the page renders with real content and the embedded
// screenshot loads, not a broken image.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT_DIR = "test-evidence/marketing/draft-generator-page";
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

const resp = await page.goto(`${BASE}/platform/draft-generator`, {
  waitUntil: "networkidle",
  timeout: 30000,
});
const status = resp?.status() ?? null;
await page.waitForTimeout(1000);

const heroText = await page.locator("h1").first().innerText().catch(() => null);
const imgNaturalWidth = await page
  .locator('img[alt*="Draft Generator wizard"]')
  .evaluate((el) => el.naturalWidth)
  .catch(() => null);

await page.screenshot({ path: `${OUT_DIR}/full-page.png`, fullPage: true });

console.log(
  JSON.stringify(
    { status, heroText, imgNaturalWidth, consoleErrors: errors },
    null,
    2,
  ),
);

await browser.close();
