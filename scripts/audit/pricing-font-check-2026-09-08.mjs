import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000/pricing", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const h1 = document.querySelector("h1");
  const cs = getComputedStyle(h1);
  return {
    fontFamily: cs.fontFamily,
    cssVar: getComputedStyle(document.documentElement).getPropertyValue("--mk-display") || getComputedStyle(document.body).getPropertyValue("--mk-display"),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
