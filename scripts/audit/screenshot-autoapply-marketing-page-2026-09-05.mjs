import { chromium } from "playwright";

const OUT = "AUDIT_SCREENSHOTS/platform-autoapply-marketing-page-2026-09-05.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:3000/platform/autoapply", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);

await page.screenshot({ path: OUT, fullPage: true });
console.log("Saved", OUT);

await browser.close();
