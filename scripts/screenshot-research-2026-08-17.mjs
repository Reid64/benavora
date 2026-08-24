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
const OUT = process.argv[2] || "smoke-test-output/research-page.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 30000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  await page.goto(`${BASE_URL}/research`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);
  console.log("[nav] research url:", page.url());

  await page.screenshot({ path: OUT, fullPage: true });
  console.log("[shot] saved", OUT);

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
