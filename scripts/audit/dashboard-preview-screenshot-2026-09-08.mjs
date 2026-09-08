import { chromium } from "playwright";

const OUT_DIR = "scripts/audit";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("response", (res) => {
    if (res.status() >= 400) console.log("BAD RESPONSE", res.status(), res.url());
  });
  page.on("pageerror", (err) => console.log("PAGE ERROR", err.message));

  await page.goto("http://localhost:3000/#try-it", { waitUntil: "networkidle" });
  const widget = page.locator('[aria-label="Interactive sample dashboard preview (demo data only)"]');
  await widget.scrollIntoViewIfNeeded();
  await widget.waitFor({ state: "visible" });

  await page.screenshot({ path: `${OUT_DIR}/dashboard-preview-01-initial.png`, fullPage: false, clip: await widget.boundingBox() });

  // Interact: filter to Foundation-only opportunities
  const filterBtn = page.getByRole("button", { name: "Foundation", exact: true });
  console.log("filter button count:", await filterBtn.count());
  await filterBtn.click();
  await page.waitForTimeout(300);

  // Interact: expand a score breakdown panel
  const expandBtn = page.getByRole("button", { name: /View Score Breakdown/ });
  console.log("expand button count:", await expandBtn.count());
  await expandBtn.first().click();
  await page.waitForTimeout(300);
  console.log("Key Risks count after click:", await page.getByText("Key Risks").count());
  console.log("expand button text now:", await expandBtn.first().innerText().catch((e) => `ERR ${e.message}`));

  const box = await widget.boundingBox();
  await page.screenshot({ path: `${OUT_DIR}/dashboard-preview-02-filtered-expanded.png`, fullPage: false, clip: box });
  await page.screenshot({ path: `${OUT_DIR}/dashboard-preview-debug-fullpage.png`, fullPage: true });

  console.log("OK: screenshots captured");
  console.log("console errors so far:", errors);

  await browser.close();
}

main().catch((err) => {
  console.error("FAILED", err);
  process.exit(1);
});
