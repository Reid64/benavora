import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:3000/platform/prospect-intelligence";
const outPath = process.argv[3] || "AUDIT_SCREENSHOTS/prospect-intelligence-page.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const status = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
console.log("HTTP status:", status?.status());
console.log("Final URL:", page.url());

await page.waitForTimeout(500);
await page.screenshot({ path: outPath, fullPage: true });
console.log("Saved:", outPath);

const h1 = await page.locator("h1").first().textContent();
console.log("H1:", h1);

await browser.close();
