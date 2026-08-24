import { chromium } from "playwright";

const EMAIL = "info@faithfoundationsf.org";
const PASSWORD = "Fasterman1945#@#";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleMsgs = [];
  const netLog = [];
  page.on("console", (msg) => consoleMsgs.push(`${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => consoleMsgs.push("pageerror: " + err.message));
  page.on("requestfailed", (req) => netLog.push(`REQFAILED ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`));

  const resp = await page.goto("http://localhost:3000/login", { waitUntil: "load", timeout: 45000 });
  console.log("page load status:", resp.status());
  console.log("final url:", page.url());
  await page.waitForTimeout(1500);

  const authResponses = [];
  page.on("response", async (r) => {
    const url = r.url();
    if (url.includes("supabase.co/auth") || url.includes("/api/auth") || url.includes("/login")) {
      let body = null;
      try { body = await r.text(); } catch { body = "(could not read body)"; }
      authResponses.push({ url, status: r.status(), body: body?.slice(0, 800) });
    }
  });

  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD);
  const start = Date.now();
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  const elapsed = Date.now() - start;

  console.log("URL after submit:", page.url(), "elapsed ms:", elapsed);
  const afterText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log("BODY AFTER SUBMIT:", afterText);
  console.log("AUTH RESPONSES:", JSON.stringify(authResponses, null, 2));
  console.log("CONSOLE:", JSON.stringify(consoleMsgs.slice(0, 30), null, 2));
  console.log("NET FAILURES:", JSON.stringify(netLog.slice(0, 20), null, 2));

  await page.screenshot({ path: "smoke-test-output/LOCAL-login-attempt-2026-08-18.png", fullPage: true });
  await browser.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
