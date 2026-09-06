import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
const fails = [];
page.on("response", (r) => { if (r.status() >= 400) fails.push(`${r.status()} ${r.url()}`); });
await page.goto("http://localhost:3000/platform/discovery", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1000);
console.log(JSON.stringify(fails, null, 2));
await browser.close();
