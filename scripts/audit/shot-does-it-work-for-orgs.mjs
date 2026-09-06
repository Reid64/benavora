import { chromium } from "playwright";

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });

  const section = page.locator('section[aria-labelledby="fitcheck-title"]');
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await section.screenshot({ path: "AUDIT_SCREENSHOTS/does-it-work-for-orgs-like-mine.png" });

  await page.screenshot({ path: "AUDIT_SCREENSHOTS/does-it-work-for-orgs-like-mine-fullpage.png", fullPage: true });

  await browser.close();
  console.log("Screenshots saved.");
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
