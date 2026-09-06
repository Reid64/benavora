import { chromium } from "playwright";
import fs from "fs";

fs.mkdirSync("test-evidence/scan-intake", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto("http://localhost:3000/scan", { waitUntil: "networkidle", timeout: 60000 });
await page.screenshot({ path: "test-evidence/scan-intake/01-form-empty.png", fullPage: true });

// Trigger client-side validation with an empty submit.
await page.getByRole("button", { name: /Get My Funding Scan/i }).click();
await page.screenshot({ path: "test-evidence/scan-intake/02-validation-errors.png", fullPage: true });

// Fill the real five fields.
await page.locator("#orgNameOrWebsite").fill("Faith Foundation SF");
await page.locator("#ein").fill("94-1234567");
await page.locator("#state").selectOption("CA");
await page.locator("#primaryMission").fill("Affordable housing for veterans");
await page.locator("#fundingPriority").selectOption("capital_campaign");
await page.screenshot({ path: "test-evidence/scan-intake/03-form-filled.png", fullPage: true });

const [response] = await Promise.all([
  page.waitForResponse((res) => res.url().includes("/api/public/scan")),
  page.getByRole("button", { name: /Get My Funding Scan/i }).click(),
]);

console.log("API status:", response.status());
console.log("API body:", await response.text());

await page.waitForTimeout(500);
await page.screenshot({ path: "test-evidence/scan-intake/04-success-state.png", fullPage: true });

console.log("console errors:", JSON.stringify(consoleErrors));

await browser.close();
