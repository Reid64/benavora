// WGR-099 STEP 2: WebKit smoke test against production public pages.
import { webkit } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE_URL = "https://www.benavora.com";
const OUT_DIR = "test-evidence/remediation/wgr-099";
mkdirSync(OUT_DIR, { recursive: true });

const PAGES = [
  { path: "/", file: "home.png" },
  { path: "/platform", file: "platform.png" },
  { path: "/how-it-works", file: "how-it-works.png" },
  { path: "/pricing", file: "pricing.png" },
  { path: "/login", file: "login.png" },
];

const results = [];

async function main() {
  const browser = await webkit.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const p of PAGES) {
    const errors = [];
    const onConsole = (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    };
    const onPageError = (err) => errors.push(String(err));
    page.on("console", onConsole);
    page.on("pageerror", onPageError);

    let loadError = null;
    let bodyText = "";
    try {
      await page.goto(BASE_URL + p.path, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      bodyText = await page.evaluate(() => document.body?.innerText || "");
    } catch (e) {
      loadError = String(e);
    }

    await page.screenshot({ path: `${OUT_DIR}/${p.file}`, fullPage: true }).catch((e) => {
      loadError = loadError || `screenshot failed: ${e}`;
    });

    page.off("console", onConsole);
    page.off("pageerror", onPageError);

    const rendered = !loadError && bodyText.trim().length > 20;
    results.push({
      path: p.path,
      loadError,
      textLen: bodyText.trim().length,
      rendered,
      consoleErrors: errors.length,
      errorMessages: errors,
    });
    console.log(`[${p.path}] rendered=${rendered} textLen=${bodyText.trim().length} consoleErrors=${errors.length}`);
    for (const e of errors) console.log(`  [console error] ${e}`);
  }

  await browser.close();

  writeFileSync(`${OUT_DIR}/step2-public-smoke.json`, JSON.stringify({ timestamp: new Date().toISOString(), baseUrl: BASE_URL, browser: "webkit", results }, null, 2));
  console.log("\nWritten:", `${OUT_DIR}/step2-public-smoke.json`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
