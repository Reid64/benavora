import { chromium } from "playwright";

const PAGES = [
  { url: "http://localhost:3000/trust", out: "AUDIT_SCREENSHOTS/trust-page-risk-tiered-copy-fix-2026-09-05.png" },
  {
    url: "http://localhost:3000/platform/autoapply",
    out: "AUDIT_SCREENSHOTS/platform-autoapply-page-risk-tiered-copy-fix-2026-09-05.png",
  },
];

const browser = await chromium.launch();
for (const { url, out } of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, fullPage: true });
  console.log("Saved", out);
  await page.close();
}

await browser.close();
