import { chromium } from "playwright";
import fs from "fs";

fs.mkdirSync("test-evidence/scan-email-capture", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto("http://localhost:3000/scan", { waitUntil: "networkidle", timeout: 60000 });
await page.screenshot({ path: "test-evidence/scan-email-capture/00-intake-form.png", fullPage: true });

await page.locator("#orgNameOrWebsite").fill("Faith Foundation SF");
await page.locator("#state").selectOption("CA");
await page.locator("#primaryMission").fill("Affordable housing for veterans");
await page.locator("#fundingPriority").selectOption("capital_campaign");

const [response] = await Promise.all([
  page.waitForResponse((res) => res.url().includes("/api/public/scan")),
  page.getByRole("button", { name: /Get My Funding Scan/i }).click(),
]);
console.log("scan API status:", response.status());
console.log("scan API body:", await response.text());

await page.waitForTimeout(500);
await page.screenshot({
  path: "test-evidence/scan-email-capture/00b-post-submit-state.png",
  fullPage: true,
});
console.log("console errors:", JSON.stringify(consoleErrors));

await browser.close();
