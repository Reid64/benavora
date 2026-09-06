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

await page.locator("#orgNameOrWebsite").fill("Faith Foundation SF");
await page.locator("#ein").fill("94-1234567");
await page.locator("#state").selectOption("CA");
await page.locator("#primaryMission").fill("Affordable housing for veterans");
await page.locator("#fundingPriority").selectOption("capital_campaign");

const [scanResponse] = await Promise.all([
  page.waitForResponse((res) => res.url().includes("/api/public/scan") && !res.url().includes("/capture")),
  page.getByRole("button", { name: /Get My Funding Scan/i }).click(),
]);
console.log("scan API status:", scanResponse.status());
console.log("scan API body:", await scanResponse.text());

await page.waitForTimeout(500);
await page.screenshot({
  path: "test-evidence/scan-email-capture/01-report-with-capture-card.png",
  fullPage: true,
});

// Locate the email capture card and try submitting with no email first (validation check).
await page.getByRole("button", { name: /Save my funding profile/i }).click();
await page.screenshot({
  path: "test-evidence/scan-email-capture/02-email-validation-error.png",
  fullPage: true,
});

// Fill email, exercise "save my funding profile" (no send expected).
await page.locator("#captureEmail").fill("director@faithfoundationsf.org");
const [saveResponse] = await Promise.all([
  page.waitForResponse((res) => res.url().includes("/api/public/scan/capture")),
  page.getByRole("button", { name: /Save my funding profile/i }).click(),
]);
console.log("save-profile capture API status:", saveResponse.status());
console.log("save-profile capture API body:", await saveResponse.text());
await page.waitForTimeout(300);

// Exercise "share it with my board" with a board email filled in.
await page.locator("#boardEmails").fill("chair@board.org, treasurer@board.org");
const [shareResponse] = await Promise.all([
  page.waitForResponse((res) => res.url().includes("/api/public/scan/capture")),
  page.getByRole("button", { name: /Share it with my board/i }).click(),
]);
console.log("share-board capture API status:", shareResponse.status());
console.log("share-board capture API body:", await shareResponse.text());
await page.waitForTimeout(300);

await page.screenshot({
  path: "test-evidence/scan-email-capture/03-actions-confirmed.png",
  fullPage: true,
});

// Confirm the strategist link points at the real /demo route.
const strategistHref = await page.getByRole("link", { name: /Review it with a Benavora strategist/i }).getAttribute("href");
console.log("strategist link href:", strategistHref);

console.log("console errors:", JSON.stringify(consoleErrors));

await browser.close();
