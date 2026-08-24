import { chromium } from "playwright";
import { readFileSync } from "node:fs";

function loadEnv() {
  const raw = readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}
loadEnv();

const BASE_URL = "http://localhost:3000";
const EMAIL = "info@faithfoundationsf.org";
const PASSWORD = "Fasterman1945#@#";

function rgbToHex(rgb) {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m) return rgb;
  const [r, g, b] = m.map(Number);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 30000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  await page.goto(`${BASE_URL}/deadlines`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);
  console.log("[nav] deadlines url:", page.url());

  await page.screenshot({ path: "smoke-test-output/deadlines-calendar-after.png", fullPage: true });
  console.log("[shot] saved deadlines-calendar-after.png");

  // Computed-style check: calendar frame panel background/border
  const frame = page.locator('div.rounded-xl.shadow-sm.border.border-border').first();
  const frameCount = await frame.count();
  console.log("[check] frame panel elements found:", frameCount);
  if (frameCount > 0) {
    const style = await frame.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, borderColor: cs.borderColor, borderWidth: cs.borderTopWidth, boxShadow: cs.boxShadow };
    });
    console.log("[computed] calendar frame:", JSON.stringify(style), "bgHex:", rgbToHex(style.bg), "borderHex:", rgbToHex(style.borderColor));
  }

  // Computed-style check: active view-toggle button (frame-colored fill)
  const monthBtn = page.locator('button[aria-pressed="true"]').first();
  if (await monthBtn.count() > 0) {
    const btnStyle = await monthBtn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color };
    });
    console.log("[computed] active toggle button:", JSON.stringify(btnStyle), "bgHex:", rgbToHex(btnStyle.bg), "textHex:", rgbToHex(btnStyle.color));
  }

  // Urgency legend dot colors - must be unchanged
  const dots = page.locator('span.h-2.w-2.rounded-full');
  const dotCount = await dots.count();
  console.log("[check] legend dot count:", dotCount);
  for (let i = 0; i < dotCount; i++) {
    const bg = await dots.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor);
    console.log(`[computed] legend dot ${i}:`, bg, rgbToHex(bg));
  }

  // Switch to Week view
  await page.click('button:has-text("Week")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "smoke-test-output/deadlines-week-after.png", fullPage: true });
  console.log("[shot] saved deadlines-week-after.png");
  console.log("[nav] week url:", page.url());

  const weekFrame = page.locator('div.rounded-xl.shadow-sm.border.border-border').first();
  if (await weekFrame.count() > 0) {
    const style = await weekFrame.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, borderColor: cs.borderColor };
    });
    console.log("[computed] week frame:", JSON.stringify(style), "bgHex:", rgbToHex(style.bg), "borderHex:", rgbToHex(style.borderColor));
  }

  // Switch to List view
  await page.click('button:has-text("List")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "smoke-test-output/deadlines-list-after.png", fullPage: true });
  console.log("[shot] saved deadlines-list-after.png");
  console.log("[nav] list url:", page.url());

  // Functionality check: toggle "Show completed" checkbox
  const completedCheckbox = page.locator('input[type="checkbox"]').last();
  const beforeChecked = await completedCheckbox.isChecked();
  await completedCheckbox.click();
  await page.waitForTimeout(800);
  const afterChecked = await completedCheckbox.isChecked();
  console.log("[func] show-completed toggle:", beforeChecked, "->", afterChecked, beforeChecked !== afterChecked ? "OK" : "NO-OP/FAIL");

  // Functionality check: type filter buttons still clickable
  const filterBtn = page.locator('button:has-text("Application")').first();
  if (await filterBtn.count() > 0) {
    await filterBtn.click();
    await page.waitForTimeout(500);
    console.log("[func] type filter click: OK (no crash), url:", page.url());
  }

  // Back to calendar, switch to Compliance tab
  await page.click('button:has-text("Compliance")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "smoke-test-output/deadlines-compliance-after.png", fullPage: true });
  console.log("[shot] saved deadlines-compliance-after.png");

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
