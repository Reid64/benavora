import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "owner.e2e@benavora-test.dev";
const PASSWORD = "Benavora!E2E-Test-1";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });

  await page.goto(`${BASE}/funders`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: "funders-full-after-2026-08-18.png", fullPage: true });

  // Per-card frame colors + badge labels, to confirm Bronze default + the
  // per-subtype Slate Blue (Government) / Plum (Foundation) / Amber (Corporate).
  const cards = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[role="button"]')).filter(
      (el) => el.className && typeof el.className === "string" && el.className.includes("rounded-[14px]"),
    );
    return els.map((el) => {
      const style = getComputedStyle(el);
      const badge = el.querySelector('span[class*="rounded-full"]');
      return {
        frameBg: style.backgroundColor,
        badgeLabel: badge ? badge.textContent : null,
      };
    });
  });
  console.log("cards:", JSON.stringify(cards, null, 2));

  // Empty-state panel check via a real UI interaction (typing into the
  // search box, not URL manipulation), then wait for the client-side filter.
  const searchBox = page.getByPlaceholder("Search funders...");
  await searchBox.fill("zzz-no-such-funder-zzz");
  await page.waitForTimeout(800);
  const emptyPanel = await page.evaluate(() => {
    const match = Array.from(document.querySelectorAll("div")).find(
      (d) => d.textContent === "No funders match your filters.",
    );
    const frame = match?.parentElement;
    const frameStyle = frame ? getComputedStyle(frame) : null;
    const innerStyle = match ? getComputedStyle(match) : null;
    return {
      found: !!match,
      frameBg: frameStyle ? frameStyle.backgroundColor : null,
      innerBg: innerStyle ? innerStyle.backgroundColor : null,
    };
  });
  console.log("empty panel:", JSON.stringify(emptyPanel));
  await page.screenshot({ path: "funders-empty-after-2026-08-18.png", fullPage: true });
  await searchBox.fill("");
  await page.waitForTimeout(500);

  // Functionality check: click a card, confirm it navigates to a detail page.
  await page.waitForTimeout(300);
  const firstCard = page.locator('[role="button"].rounded-\\[14px\\]').first();
  await firstCard.click();
  await page.waitForURL("**/funders/**", { timeout: 10000 });
  console.log("navigated to:", page.url());

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
