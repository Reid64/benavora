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
  await page.waitForTimeout(1000);

  const searchBox = page.getByPlaceholder("Search funders...");
  await searchBox.fill("zzz-no-such-funder-zzz");
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    // The leaf div (no element children) whose text is the empty-state message.
    const leaf = Array.from(document.querySelectorAll("div")).find(
      (d) => d.children.length === 0 && d.textContent === "No funders match your filters.",
    );
    const outer = leaf ? leaf.parentElement : null;
    return {
      leafBg: leaf ? getComputedStyle(leaf).backgroundColor : null,
      outerBg: outer ? getComputedStyle(outer).backgroundColor : null,
      outerShadow: outer ? getComputedStyle(outer).boxShadow : null,
    };
  });
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
