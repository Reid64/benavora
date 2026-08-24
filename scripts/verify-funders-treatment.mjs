// One-off verification script for the /funders v2 page-treatment pass.
// Not a permanent test — logs in through the real login UI using the
// project's dedicated E2E owner account (tests/e2e/helpers.ts TEST_USER),
// the same account/credentials tests/e2e/auth.setup.ts already uses.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "owner.e2e@benavora-test.dev";
const PASSWORD = "Benavora!E2E-Test-1";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });

  await page.goto(`${BASE}/funders`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: "funders-treatment-after.png", fullPage: true });

  const result = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[role="button"]')).filter(
      (el) => el.className && typeof el.className === "string" && el.className.includes("rounded-[14px]"),
    );
    if (cards.length === 0) {
      return { error: "no frame cards found", bodyText: document.body.innerText.slice(0, 300) };
    }
    const first = cards[0];
    const frameStyle = getComputedStyle(first);
    const inner = first.querySelector("div");
    const innerStyle = inner ? getComputedStyle(inner) : null;
    const header = document.querySelector("h1");
    const headerStyle = header ? getComputedStyle(header) : null;
    const cta = Array.from(document.querySelectorAll("a")).find(
      (a) => a.textContent && a.textContent.includes("New funder"),
    );
    const ctaStyle = cta ? getComputedStyle(cta) : null;
    return {
      cardCount: cards.length,
      frameBg: frameStyle.backgroundColor,
      frameShadow: frameStyle.boxShadow,
      innerBg: innerStyle ? innerStyle.backgroundColor : null,
      headerText: header ? header.textContent : null,
      headerColor: headerStyle ? headerStyle.color : null,
      ctaBg: ctaStyle ? ctaStyle.backgroundColor : null,
      ctaColor: ctaStyle ? ctaStyle.color : null,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  // Also check the "no results" panel (frame+ivory technique) and the
  // AutoApply batch-select bar's contrast, both real UI states.
  await page.fill('input[aria-label="Search funders"]', "zzz-no-such-funder-zzz");
  await page.waitForTimeout(600);
  const emptyPanel = await page.evaluate(() => {
    const el = document.querySelector("body");
    const text = el?.innerText.includes("No funders match your filters.");
    const frame = Array.from(document.querySelectorAll("div")).find(
      (d) => d.textContent === "No funders match your filters.",
    )?.parentElement;
    const frameStyle = frame ? getComputedStyle(frame) : null;
    return { foundText: !!text, frameBg: frameStyle ? frameStyle.backgroundColor : null };
  });
  console.log("empty panel:", JSON.stringify(emptyPanel));
  await page.screenshot({ path: "funders-treatment-empty.png", fullPage: true });

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
