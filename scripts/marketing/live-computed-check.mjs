// Live production computed-style check: opens the real deployed site and
// records getComputedStyle for the nav bar, the "Book demo" CTA, and the
// home hero background, so design-token drift between source and the live
// deployment is caught with real evidence instead of assumed from source.
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "https://www.benavora.com";
const ROOT = process.cwd();
const EVIDENCE_DIR = path.join(ROOT, "test-evidence", "marketing", "mkt-004");

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30000 });

  const navBg = await page.evaluate(() => {
    const header = document.querySelector("header");
    return header ? getComputedStyle(header).backgroundColor : null;
  });

  const bookDemoBg = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a, button"));
    const el = links.find((n) => {
      const t = n.textContent && n.textContent.trim().toLowerCase();
      return t === "book demo" || t === "book a demo";
    });
    return el ? getComputedStyle(el).backgroundColor : null;
  });

  const heroBg = await page.evaluate(() => {
    const header = document.querySelector("header");
    const sections = Array.from(document.querySelectorAll("section"));
    // hero is the first section immediately below the sticky header
    const hero = sections.find((s) => {
      const r = s.getBoundingClientRect();
      const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
      return r.top <= headerBottom + 5 && r.height > 300;
    });
    return hero ? getComputedStyle(hero).backgroundColor : null;
  });

  const result = {
    captured_at: new Date().toISOString(),
    base_url: BASE_URL,
    nav_background_color: navBg,
    book_demo_background_color: bookDemoBg,
    home_hero_background_color: heroBg,
    expected: {
      nav_background_color: "rgb(247, 245, 239)",
    },
  };

  fs.writeFileSync(path.join(EVIDENCE_DIR, "live-computed.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
