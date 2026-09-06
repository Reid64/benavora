import { chromium } from "playwright";

const OUT_DIR = "C:/Users/manag/Documents/benavora/AUDIT_SCREENSHOTS";
const browser = await chromium.launch();

async function shoot(viewport, label) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT_DIR}/built-${label}-full.png`, fullPage: true });
  if (errors.length) {
    console.log(`[${label}] console/page errors:`, errors.slice(0, 10));
  }
  await page.close();
}

await shoot({ width: 1440, height: 900 }, "desktop");
await shoot({ width: 390, height: 844 }, "mobile");
await browser.close();
console.log("done");
