import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(600);

const info = await page.evaluate(() => {
  const contrast = document.querySelector(".bm-contrast");
  const hero = document.querySelector(".bm-hero");
  const results = {};
  if (contrast) {
    const r = contrast.getBoundingClientRect();
    results.bmContrast = { width: r.width, left: r.left, right: r.right, bg: getComputedStyle(contrast).backgroundColor };
  }
  if (hero) {
    const r = hero.getBoundingClientRect();
    results.bmHero = { width: r.width, left: r.left, right: r.right, bg: getComputedStyle(hero).backgroundColor };
  }
  results.viewportWidth = window.innerWidth;
  results.bodyBg = getComputedStyle(document.body).backgroundColor;
  return results;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
