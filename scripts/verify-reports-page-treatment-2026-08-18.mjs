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
const TAG = process.argv[2] || "before"; // "before" | "after"
const OUT = `smoke-test-output/reports-page-${TAG}.png`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 30000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  await page.goto(`${BASE_URL}/reports`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log(`[nav][${TAG}] url:`, page.url());

  await page.screenshot({ path: OUT, fullPage: true });
  console.log(`[shot][${TAG}] saved`, OUT);

  // Real computed-style check on the first report category card's frame + a button.
  const cardFrame = await page.evaluate(() => {
    // The frame is the outer wrapping div of the first category card grid item.
    const grid = document.querySelectorAll("main .grid, .grid")[0];
    const firstCard = grid ? grid.children[0] : null;
    if (!firstCard) return null;
    const cs = getComputedStyle(firstCard);
    return {
      backgroundColor: cs.backgroundColor,
      boxShadow: cs.boxShadow,
      borderRadius: cs.borderRadius,
    };
  });
  console.log(`[computed][${TAG}] first-card-outer:`, JSON.stringify(cardFrame));

  const innerCardBg = await page.evaluate(() => {
    const grid = document.querySelectorAll("main .grid, .grid")[0];
    const firstCard = grid ? grid.children[0] : null;
    const inner = firstCard ? firstCard.firstElementChild : null;
    if (!inner) return null;
    const cs = getComputedStyle(inner);
    return { backgroundColor: cs.backgroundColor, borderRadius: cs.borderRadius };
  });
  console.log(`[computed][${TAG}] first-card-inner:`, JSON.stringify(innerCardBg));

  const buttonStyle = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Generate Board Report"),
    );
    if (!btn) return null;
    const cs = getComputedStyle(btn);
    return { backgroundColor: cs.backgroundColor, color: cs.color };
  });
  console.log(`[computed][${TAG}] generate-button:`, JSON.stringify(buttonStyle));

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
