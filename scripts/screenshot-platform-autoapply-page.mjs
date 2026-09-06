import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const OUT = process.argv[2] || "smoke-test-output/platform-autoapply-page.png";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/platform/autoapply`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: OUT, fullPage: true });
  console.log("[shot] saved", OUT);

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
