import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../../AUDIT_SCREENSHOTS/mkt003-verify");

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const SOURCE_HTML = "file:///C:/Users/manag/Downloads/Recent Downloads/Benavora-Marketing (10).html";
const LIVE_URL = "https://www.benavora.com/";

async function shoot(browser, url, viewportName, viewport, label) {
  const page = await browser.newPage({ viewport });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200); // let animations/fonts settle
  const outPath = path.join(outDir, `${label}-${viewportName}.png`);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log("saved", outPath);
  await page.close();
}

const browser = await chromium.launch();
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  await shoot(browser, SOURCE_HTML, name, viewport, "source");
  await shoot(browser, LIVE_URL, name, viewport, "live");
}
await browser.close();
