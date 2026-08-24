import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const GOLD_RGB = "rgb(184, 138, 46)"; // #B88A2E
const OLD_BLUE_HEXES = ["#0077B6", "#0096C7", "#00B4D8", "#0284C7", "#023E8A"];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.goto("https://www.benavora.com/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);

  mkdirSync("smoke-test-output", { recursive: true });
  await page.screenshot({ path: "smoke-test-output/PROD-marketing-before-2026-08-18.png", fullPage: true });

  // Check the logo image src
  const logoInfo = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img")).filter((img) =>
      /logo/i.test(img.src) || /logo/i.test(img.alt || ""),
    );
    return imgs.map((img) => ({ src: img.src, alt: img.alt, width: img.naturalWidth, height: img.naturalHeight }));
  });

  // Check computed styles of key brand elements: nav bg, primary CTA buttons, headline accents
  const brandCheck = await page.evaluate(() => {
    function styleOf(el) {
      if (!el) return null;
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, borderColor: s.borderColor };
    }
    const results = {};
    // nav / header
    results.nav = styleOf(document.querySelector("nav") || document.querySelector("header"));
    // all buttons/links with role button-like classes
    const ctaCandidates = Array.from(document.querySelectorAll("a, button")).filter((el) => {
      const text = (el.textContent || "").trim().toLowerCase();
      return /sign in|get started|log in|sign up|start free|request demo/.test(text);
    });
    results.ctas = ctaCandidates.slice(0, 10).map((el) => ({
      text: el.textContent.trim().slice(0, 30),
      href: el.getAttribute("href"),
      ...styleOf(el),
    }));
    return results;
  });

  // Full hex frequency scan of rendered inline styles won't work for computed;
  // instead scan all elements for background-color / color matching gold or old blue rgb equivalents
  function hexToRgb(hex) {
    const m = hex.replace("#", "").match(/.{2}/g);
    const [r, g, b] = m.map((x) => parseInt(x, 16));
    return `rgb(${r}, ${g}, ${b})`;
  }
  const oldBlueRgbs = OLD_BLUE_HEXES.map(hexToRgb);

  const colorFrequency = await page.evaluate(({ oldBlueRgbs, goldRgb }) => {
    const counts = { gold: 0, oldBlue: 0, total: 0 };
    const oldBlueHits = [];
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      const s = getComputedStyle(el);
      counts.total++;
      if (s.backgroundColor === goldRgb || s.color === goldRgb || s.borderColor === goldRgb) counts.gold++;
      for (const ob of oldBlueRgbs) {
        if (s.backgroundColor === ob || s.color === ob || s.borderColor === ob) {
          counts.oldBlue++;
          if (oldBlueHits.length < 15) {
            oldBlueHits.push({
              tag: el.tagName,
              text: (el.textContent || "").trim().slice(0, 40),
              bg: s.backgroundColor,
              color: s.color,
            });
          }
        }
      }
    }
    return { counts, oldBlueHits };
  }, { oldBlueRgbs, goldRgb: GOLD_RGB });

  console.log("=== LOGO ===");
  console.log(JSON.stringify(logoInfo, null, 2));
  console.log("=== BRAND CHECK ===");
  console.log(JSON.stringify(brandCheck, null, 2));
  console.log("=== COLOR FREQUENCY ===");
  console.log(JSON.stringify(colorFrequency, null, 2));

  await browser.close();
})();
