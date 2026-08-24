import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const EMAIL = "info@faithfoundationsf.org";
const PASSWORD = "Fasterman1945#@#";

function rgbToHex(rgb) {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m) return rgb;
  const [r, g, b] = m.map(Number);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const phase = process.argv[2] || "before";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  const apiResponses = [];
  page.on("response", async (res) => {
    if (res.url().includes("/api/compliance")) {
      apiResponses.push({ url: res.url(), status: res.status() });
    }
  });

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 30000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  await page.goto(`${BASE_URL}/compliance`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log("[nav] url:", page.url());

  console.log("[api] responses:", JSON.stringify(apiResponses));

  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasError = bodyText.includes("Could not load compliance");
  console.log("[check] error banner present:", hasError);

  const eventCount = await page.locator("li").count();
  console.log("[check] rendered <li> item count (events+requirements):", eventCount);

  const scoreBadge = await page.locator("text=Compliance Score").count();
  console.log("[check] score badge present:", scoreBadge > 0);

  await page.screenshot({ path: `smoke-test-output/compliance-${phase}-2026-08-17.png`, fullPage: true });
  console.log(`[shot] saved compliance-${phase}-2026-08-17.png`);

  if (phase === "after") {
    // Frame panel computed style
    const frame = page.locator("div").filter({ hasText: "Compliance Score" }).first();
    // Check a card panel border/background
    const panels = page.locator('div[style*="border-radius: 16px"]');
    const panelCount = await panels.count();
    console.log("[check] framed panel count:", panelCount);
    if (panelCount > 0) {
      const style = await panels.first().evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, borderColor: cs.borderColor, borderWidth: cs.borderTopWidth, boxShadow: cs.boxShadow };
      });
      console.log("[computed] first panel:", JSON.stringify(style), "bgHex:", rgbToHex(style.bg), "borderHex:", rgbToHex(style.borderColor));
    }

    // Button check
    const btn = page.locator('button:has-text("New Event")').first();
    if (await btn.count() > 0) {
      const btnStyle = await btn.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, color: cs.color };
      });
      console.log("[computed] New Event button:", JSON.stringify(btnStyle), "bgHex:", rgbToHex(btnStyle.bg), "colorHex:", rgbToHex(btnStyle.color));
    }

    // Header title color
    const h1 = page.locator("h1").first();
    if (await h1.count() > 0) {
      const h1Style = await h1.evaluate((el) => getComputedStyle(el).color);
      console.log("[computed] h1 color:", h1Style, "hex:", rgbToHex(h1Style));
    }
  }

  await browser.close();
}
main();
