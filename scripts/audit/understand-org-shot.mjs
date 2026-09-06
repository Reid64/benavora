import { chromium } from "playwright";

const url = "http://localhost:3100/";
const outPath = "AUDIT_SCREENSHOTS/will-it-understand-my-org.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });

const section = page.locator("section[aria-labelledby='understand-title']");
await section.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await section.screenshot({ path: outPath });

console.log("Saved:", outPath);
await browser.close();
