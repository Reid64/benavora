import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve("AUDIT_SCREENSHOTS/mkt-marketing-verify");
const SRC_HTML =
  "file:///C:/Users/manag/Downloads/Recent Downloads/Benavora-Marketing (10).html";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

async function shoot(browser, url, viewport, outfile, fullPage = true) {
  const page = await browser.newPage({ viewport });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: outfile, fullPage });
  await page.close();
}

const browser = await chromium.launch();

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  await shoot(browser, "http://localhost:3000/", viewport, path.join(OUT, `live-${name}.png`));
  await shoot(browser, SRC_HTML, viewport, path.join(OUT, `source-${name}.png`));
}

await browser.close();
console.log("done");
