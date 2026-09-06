import { chromium } from "playwright";
import fs from "fs";

const OUT_DIR = "test-evidence/marketing/solutions-seo-2026-09-05";
fs.mkdirSync(OUT_DIR, { recursive: true });

const PAGES = [
  "nonprofit-funding-software",
  "grant-discovery-software",
  "grant-matching-software",
  "ai-grant-writing-software",
  "grant-application-automation",
];

const browser = await chromium.launch();
// No storageState - these must be reachable *unauthenticated*, confirming the
// middleware PUBLIC_PATHS allowlist update actually took effect and none of
// them 307-redirect to /login.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

for (const slug of PAGES) {
  const page = await context.newPage();
  const res = await page.goto(`http://localhost:3000/solutions/${slug}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  const finalUrl = page.url();
  const status = res ? res.status() : null;
  const title = await page.title();
  console.log(`${slug}: status=${status} finalUrl=${finalUrl} title="${title}"`);
  if (finalUrl.includes("/login")) {
    console.error(`  !!! ${slug} redirected to /login - middleware allowlist not applied`);
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT_DIR}/${slug}-hero.png`, fullPage: false });
  await page.screenshot({ path: `${OUT_DIR}/${slug}-full.png`, fullPage: true });
  await page.close();
}

await browser.close();
console.log("Done.");
