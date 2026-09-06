import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const OUT = path.resolve("AUDIT_SCREENSHOTS/seo-batch-6-new-solutions");
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  "nonprofit-outreach-automation",
  "grant-deadline-tracking",
  "human-in-the-loop-ai",
  "autonomous-fundraising-platform",
  "funding-operations-software",
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const results = [];
for (const slug of PAGES) {
  const url = `http://localhost:3000/solutions/${slug}`;
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(500);
  const status = resp ? resp.status() : null;
  const title = await page.title();
  await page.screenshot({ path: path.join(OUT, `${slug}.png`), fullPage: true });
  results.push({ slug, status, title });
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
