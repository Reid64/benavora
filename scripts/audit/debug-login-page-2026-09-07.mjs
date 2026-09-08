import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const failed = [];
  page.on("requestfailed", (req) => failed.push(`${req.url()} :: ${req.failure()?.errorText}`));
  const statuses = [];
  page.on("response", (res) => {
    if (res.url().includes(".css") || res.url().includes("layout.css")) {
      statuses.push(`${res.status()} ${res.url()}`);
    }
  });

  await page.goto("http://localhost:3000/login", { waitUntil: "load" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "scripts/audit/debug-login-raw.png", fullPage: true });

  console.log("=== FAILED_REQUESTS ===", JSON.stringify(failed, null, 2));
  console.log("=== CSS_STATUSES ===", JSON.stringify(statuses, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
