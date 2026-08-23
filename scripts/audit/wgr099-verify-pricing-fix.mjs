// WGR-099 STEP 4: verify the /pricing @import hydration fix, WebKit, local build.
import { webkit, chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE_URL = process.argv[2] || "http://localhost:3102";
const OUT_DIR = "test-evidence/remediation/wgr-099";
mkdirSync(OUT_DIR, { recursive: true });

async function testPage(browserType, browserName) {
  const browser = await browserType.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  let loadError = null;
  let bodyText = "";
  try {
    await page.goto(BASE_URL + "/pricing", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    bodyText = await page.evaluate(() => document.body?.innerText || "");
  } catch (e) {
    loadError = String(e);
  }
  await page.screenshot({ path: `${OUT_DIR}/pricing-${browserName}-fixed.png`, fullPage: true }).catch(() => {});
  await browser.close();

  const result = {
    browser: browserName,
    baseUrl: BASE_URL,
    loadError,
    textLen: bodyText.trim().length,
    rendered: !loadError && bodyText.trim().length > 20,
    consoleErrors: errors.length,
    errorMessages: errors,
  };
  console.log(`[${browserName}] /pricing rendered=${result.rendered} textLen=${result.textLen} consoleErrors=${errors.length}`);
  for (const e of errors) console.log(`  [console error] ${e}`);
  return result;
}

async function main() {
  const webkitResult = await testPage(webkit, "webkit");
  const chromiumResult = await testPage(chromium, "chromium");
  writeFileSync(
    `${OUT_DIR}/step4-pricing-fix-verify.json`,
    JSON.stringify({ timestamp: new Date().toISOString(), results: [webkitResult, chromiumResult] }, null, 2)
  );
  console.log("\nWritten:", `${OUT_DIR}/step4-pricing-fix-verify.json`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
