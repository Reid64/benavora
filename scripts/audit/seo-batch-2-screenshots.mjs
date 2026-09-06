import { chromium } from "playwright";
import path from "node:path";

const OUT = path.resolve("AUDIT_SCREENSHOTS/seo-batch-2-2026-09-05");

const PAGES = [
  "funding-pipeline-software",
  "corporate-giving-database",
  "corporate-donation-application-software",
  "nonprofit-prospect-research",
  "donor-prospecting-intelligence",
];

async function shoot(browser, url, outfile) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: outfile, fullPage: true });
  await page.close();
  return { status: resp?.status(), errors };
}

const browser = await chromium.launch();
const results = {};
for (const slug of PAGES) {
  const url = `http://localhost:3000/solutions/${slug}`;
  const outfile = path.join(OUT, `${slug}.png`);
  try {
    results[slug] = await shoot(browser, url, outfile);
  } catch (e) {
    results[slug] = { error: String(e) };
  }
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
