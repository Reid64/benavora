import { chromium } from "playwright";

const OUT_DIR = "AUDIT_SCREENSHOTS";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });

  const section = page.locator("section", { has: page.locator("#contrast-title") });
  await section.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(300);
  await section.screenshot({ path: `${OUT_DIR}/manual-vs-benavora-desktop.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(300);
  await section.screenshot({ path: `${OUT_DIR}/manual-vs-benavora-mobile.png` });

  await browser.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
