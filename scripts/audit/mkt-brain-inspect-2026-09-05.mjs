import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1500);
await page.locator(".bnf-fleet").scrollIntoViewIfNeeded();
await page.waitForTimeout(1200);

const data = await page.evaluate(() => {
  function info(sel) {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      zIndex: cs.zIndex,
      position: cs.position,
      opacity: cs.opacity,
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage?.slice(0, 60),
      display: cs.display,
      visibility: cs.visibility,
    };
  }
  const swirlEls = Array.from(document.querySelectorAll(".bnf-swirl")).map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, opacity: cs.opacity, stroke: cs.stroke, className: el.getAttribute("class") };
  });
  return {
    stage: info(".bnf-stage"),
    photo: info(".bnf-brain-photo"),
    svg: info(".bnf-svg"),
    firefield: info(".bnf-firefield"),
    swirlEls,
  };
});

console.log(JSON.stringify(data, null, 2));
await browser.close();
