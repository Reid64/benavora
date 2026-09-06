import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/demo", { waitUntil: "networkidle", timeout: 60000 });

await page.screenshot({ path: "AUDIT_SCREENSHOTS/demo-page-intake.png", fullPage: true });
console.log("intake screenshot done");

await browser.close();
