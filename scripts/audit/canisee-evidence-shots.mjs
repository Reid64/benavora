// One-off evidence capture (not part of the test suite): screenshots the new
// homepage "Can I see it" section and the new /tour placeholder page against
// the local dev server, unauthenticated (both are public marketing routes).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT_DIR = "test-evidence/marketing/can-i-see-it";
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Full homepage screenshot won't include the section without scrolling to it;
// use the anchor-free approach: find the section by its heading text.
await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 30000 });
const heading = page.getByText("This is the real product.");
await heading.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/homepage-can-i-see-it-section.png` });

const ctaLink = page.getByRole("link", { name: /Take the full tour/ });
await ctaLink.evaluate((el) => el.scrollIntoView({ behavior: "instant", block: "center" }));
await page.waitForTimeout(500);
const ctaBg = await ctaLink.evaluate((el) => getComputedStyle(el).backgroundColor);
if (ctaBg === "rgba(0, 0, 0, 0)") {
  throw new Error("Take the full tour CTA has no background color — styling regression");
}
await page.screenshot({ path: `${OUT_DIR}/homepage-cta.png` });

await page.goto(`${BASE}/tour`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}/tour-placeholder-page.png` });

await browser.close();
console.log("done, cta background:", ctaBg);
