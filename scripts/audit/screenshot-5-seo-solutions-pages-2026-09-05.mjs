import { chromium } from "playwright";

const BASE = "http://localhost:3001";
const PAGES = [
  "funding-pipeline-software",
  "corporate-giving-database",
  "corporate-donation-application-software",
  "nonprofit-prospect-research",
  "donor-prospecting-intelligence",
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

for (const slug of PAGES) {
  const url = `${BASE}/solutions/${slug}`;
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  const status = resp ? resp.status() : "no-response";
  const out = `AUDIT_SCREENSHOTS/solutions-${slug}-2026-09-05.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(slug, "HTTP", status, "->", out);
}

await browser.close();
