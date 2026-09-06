// One-off script (not part of the test suite): loads the three candidate
// dashboard pages (Research, Draft Generator, AutoApply Queue) authenticated
// as the real E2E test owner, using the storage state already produced by
// tests/e2e/auth.setup.ts, and saves a full-page screenshot of each so we can
// pick whichever renders most cleanly for the homepage "Can I see it" section.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const STORAGE_STATE = "tests/e2e/.auth/owner.json";
const OUT_DIR = "test-evidence/marketing/tour-candidates";
mkdirSync(OUT_DIR, { recursive: true });

const CANDIDATES = [
  { name: "research", path: "/research" },
  { name: "draft-generator", path: "/draft-generator" },
  { name: "autoapply-main", path: "/autoapply" },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: STORAGE_STATE,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

const results = [];
for (const c of CANDIDATES) {
  const errors = [];
  page.removeAllListeners("pageerror");
  page.removeAllListeners("console");
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  let status = null;
  try {
    const resp = await page.goto(`${BASE}${c.path}`, { waitUntil: "networkidle", timeout: 30000 });
    status = resp?.status() ?? null;
    await page.waitForTimeout(1500);
  } catch (e) {
    errors.push(`navigation error: ${e}`);
  }

  const url = page.url();
  const shotPath = `${OUT_DIR}/${c.name}.png`;
  await page.screenshot({ path: shotPath, fullPage: false });

  results.push({ name: c.name, requestedPath: c.path, finalUrl: url, status, errors, shotPath });
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
