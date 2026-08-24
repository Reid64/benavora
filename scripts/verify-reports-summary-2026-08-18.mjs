import { chromium } from "playwright";
import { readFileSync } from "node:fs";

function loadEnv() {
  const raw = readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}
loadEnv();

const BASE_URL = "http://localhost:3000";
const EMAIL = "info@faithfoundationsf.org";
const PASSWORD = "Fasterman1945#@#";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1800 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 30000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  await page.goto(`${BASE_URL}/reports`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);

  const buttons = await page.$$("button");
  let clicked = false;
  for (const btn of buttons) {
    const text = await btn.textContent();
    if (text && text.includes("Generate Board Report")) {
      // second occurrence is the Board Report Summary generator
      const box = await btn.boundingBox();
      console.log("[found button]", text.trim(), box?.y);
    }
  }
  const summaryButtons = await page.$$('button:has-text("Generate Board Report")');
  if (summaryButtons.length >= 2) {
    await summaryButtons[1].click();
    clicked = true;
  }
  console.log("[clicked summary generate]", clicked);

  await page.waitForTimeout(8000);

  const errorVisible = await page.locator("text=Summary generation failed").count();
  console.log("[summary error count]", errorVisible);

  await page.screenshot({ path: "smoke-test-output/reports-page-summary-after.png", fullPage: true });
  console.log("[shot] saved smoke-test-output/reports-page-summary-after.png");

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
