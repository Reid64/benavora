import { chromium } from "playwright";
import fs from "fs";

const outDir = "test-evidence/marketing/demo-flow";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

await page.goto("http://localhost:3000/demo", { waitUntil: "networkidle", timeout: 60000 });
await page.screenshot({ path: `${outDir}/1-intake.png`, fullPage: true });

await page.fill("#workEmail", "jane@faithfoundationsf.org");
await page.fill("#orgWebsite", "faithfoundationsf.org");
await page.selectOption("#role", "development_director");
await page.fill("#primaryFundingChallenge", "We keep missing deadlines because research and drafting eat all our capacity.");
await page.screenshot({ path: `${outDir}/2-intake-filled.png`, fullPage: true });

await page.click('button[type="submit"]');
await page.waitForResponse((res) => res.url().includes("/api/public/demo") && res.request().method() === "POST", { timeout: 30000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/3-calendar-step.png`, fullPage: true });

const continueButton = page.getByRole("button", { name: /Continue|I.ve booked a time/ });
if (await continueButton.count()) {
  await continueButton.first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/4-prepare-step.png`, fullPage: true });
}

console.log("done");
await browser.close();
