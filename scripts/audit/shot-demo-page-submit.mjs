import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/demo", { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("#workEmail");

await page.fill("#workEmail", "e2e-test@example.org");
await page.fill("#orgWebsite", "example.org");
await page.selectOption("#role", "grant_writer");
await page.fill("#primaryFundingChallenge", "Testing the demo flow end to end for verification purposes");
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);

await page.screenshot({ path: "AUDIT_SCREENSHOTS/demo-page-after-submit.png", fullPage: true });
console.log("post-submit screenshot done");

await browser.close();
