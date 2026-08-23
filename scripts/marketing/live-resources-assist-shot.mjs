// Opens /resources on the live site, asks the inline Assist widget a
// question, waits for the response (answer or error state), and screenshots
// the widget - real evidence of the widget's live behavior, whatever that is.
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "https://www.benavora.com";
const ROOT = process.cwd();
const EVIDENCE_DIR = path.join(ROOT, "test-evidence", "marketing", "mkt-004");

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(`${BASE_URL}/resources#ask`, { waitUntil: "networkidle", timeout: 30000 });

  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 10000 });
  await textarea.fill("What is Form 990-PF?");
  await textarea.press("Enter");

  // wait for either an assistant bubble or an error message to render
  await page.waitForTimeout(6000);

  const ask = page.locator("#ask");
  await ask.screenshot({ path: path.join(EVIDENCE_DIR, "resources-assist-error.png") });

  console.log("screenshot saved");
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
