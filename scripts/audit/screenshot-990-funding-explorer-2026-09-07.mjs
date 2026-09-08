import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const EMAIL = "owner.e2e@benavora-test.dev";
const PASSWORD = "Benavora!E2E-Test-1";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});

  const apiResponses = [];
  page.on("response", async (res) => {
    if (res.url().includes("990-funding-pattern-explorer")) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      apiResponses.push({ url: res.url(), status: res.status(), body });
    }
  });

  await page.goto(`${BASE_URL}/intelligence/990-funding-pattern-explorer`, {
    waitUntil: "networkidle",
  });

  await page.waitForSelector("text=Fetching real 990 filing data", { state: "hidden", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  await page.screenshot({
    path: "scripts/audit/990-explorer-dell-2026-09-07.png",
    fullPage: true,
  });

  const walmartButton = page.getByRole("button", { name: /Wal-mart Foundation/i });
  await walmartButton.click();
  await page.waitForTimeout(2500);

  await page.screenshot({
    path: "scripts/audit/990-explorer-walmart-2026-09-07.png",
    fullPage: true,
  });

  const bodyText = await page.textContent("body");

  console.log("=== API_RESPONSES ===");
  console.log(JSON.stringify(apiResponses, null, 2));
  console.log("=== CONSOLE_ERRORS ===");
  console.log(JSON.stringify(consoleErrors, null, 2));
  console.log("=== PAGE_ERRORS ===");
  console.log(JSON.stringify(pageErrors, null, 2));
  console.log("=== PAGE_HAS_990_TITLE ===", bodyText?.includes("990 Funding Pattern Explorer"));
  console.log("=== CURRENT_URL ===", page.url());

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
