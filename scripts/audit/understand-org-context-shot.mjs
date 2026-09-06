import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
await page.goto("http://localhost:3100/", { waitUntil: "networkidle" });
const box = await page.locator("section[aria-labelledby='understand-title']").boundingBox();
await page.mouse.wheel(0, box.y - 150);
await page.waitForTimeout(300);
await page.screenshot({ path: "AUDIT_SCREENSHOTS/will-it-understand-my-org-context.png" });
console.log("Saved context screenshot");
await browser.close();
