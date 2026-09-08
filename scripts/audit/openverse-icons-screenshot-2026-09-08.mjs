import { chromium } from "playwright";
import path from "path";

const BASE = "http://localhost:3000";
const OUT_DIR = "scripts/audit";

const SOLUTION_SLUGS = [
  "housing",
  "faith-based",
  "veterans",
  "education",
  "human-services",
  "community-development",
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  for (const slug of SOLUTION_SLUGS) {
    await page.goto(`${BASE}/solutions/${slug}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const file = path.join(OUT_DIR, `openverse-icons-2026-09-08-solutions-${slug}.png`);
    await page.screenshot({ path: file });
    console.log("saved", file);
  }

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const dashboardHeading = page.getByText("Opportunities", { exact: false }).first();
  await dashboardHeading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, "openverse-icons-2026-09-08-homepage-dashboard-preview.png") });

  const viewButton = page.getByRole("button", { name: /View Score Breakdown/i }).first();
  const count = await viewButton.count();
  if (count > 0) {
    await viewButton.scrollIntoViewIfNeeded();
    await viewButton.click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT_DIR, "openverse-icons-2026-09-08-homepage-dashboard-preview-expanded.png"),
    });
    console.log("saved expanded screenshot");
  } else {
    console.log("WARN: 'View Score Breakdown' button not found on homepage");
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
