import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: "AUDIT_SCREENSHOTS/mkt-refresh-2026-09-06/home__brain-crop-2026-09-06.png", clip: { x: 300, y: 60, width: 850, height: 700 } });
const info = await page.evaluate(() => {
  const els = [...document.querySelectorAll('[class*="bnf"], [class*="fleet"], [class*="brain"], [class*="neural"]')];
  return els.map((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      className: el.className,
      tag: el.tagName,
      zIndex: cs.zIndex,
      backgroundImage: cs.backgroundImage.slice(0, 80),
      backgroundColor: cs.backgroundColor,
      fill: cs.fill,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    };
  }).filter(e => e.rect.w > 5 && e.rect.h > 5);
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
