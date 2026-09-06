// One-off evidence capture (not part of the test suite): screenshots the
// built /tour page and the homepage's compact preview against the local dev
// server, unauthenticated (both are public marketing routes).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT_DIR = "test-evidence/marketing/tour-built";
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto(`${BASE}/tour`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT_DIR}/tour-page-step1.png`, fullPage: true });

await page.getByRole("button", { name: /Next step/i }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/tour-page-step2.png` });

await page.getByRole("button", { name: /Next step/i }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/tour-page-step3.png` });

await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 30000 });
const heading = page.getByText("This is the real product.");
await heading.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/homepage-preview-embed.png` });

await browser.close();
console.log(JSON.stringify({ errors }, null, 2));
