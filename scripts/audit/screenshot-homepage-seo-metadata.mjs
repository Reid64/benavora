import { chromium } from "playwright";
import fs from "fs";

const BASE_URL = process.argv[2] || "http://localhost:3000";
const OUT_DIR = "AUDIT_SCREENSHOTS/mkt-seo-2026-09-05";

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

  // View-source renders the actual HTML Next.js served, syntax-highlighted,
  // so the screenshot is visual proof of what's really in the response
  // (not just a claim). Chromium's view-source lays everything out as one
  // unwrapped line by default, so toggle its "line wrap" checkbox first —
  // <head> is at the very top of the document, so it lands in the first
  // viewport once wrapped.
  await page.goto(`view-source:${BASE_URL}/`, { waitUntil: "load" });
  const bodyText = await page.textContent("body");
  const headEndIndex = bodyText.indexOf("</head>");
  if (headEndIndex === -1) {
    console.error("FAIL: </head> not found in served HTML");
    await browser.close();
    process.exit(1);
  }

  await page.click('input[type="checkbox"]');
  await page.waitForTimeout(300);

  await page.screenshot({ path: `${OUT_DIR}/homepage-view-source-head.png` });
  await browser.close();

  // Also save the raw <head> we found, as machine-checkable evidence
  // alongside the screenshot.
  const headHtml = bodyText.slice(0, headEndIndex + "</head>".length);
  fs.writeFileSync(`${OUT_DIR}/homepage-head.txt`, headHtml, "utf-8");

  console.log(`Wrote ${OUT_DIR}/homepage-view-source-head.png`);
  console.log(`Wrote ${OUT_DIR}/homepage-head.txt`);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(1);
});
