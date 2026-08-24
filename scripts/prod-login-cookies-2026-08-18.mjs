import { chromium, devices } from "playwright";

const EMAIL = "info@faithfoundationsf.org";
const PASSWORD = "Fasterman1945#@#";

async function attempt(label, contextOpts, startUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const consoleMsgs = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleMsgs.push(msg.text()); });
  page.on("pageerror", (err) => consoleMsgs.push("pageerror: " + err.message));

  await page.goto(startUrl, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1200);
  console.log(`\n=== ${label} :: start ${startUrl} -> landed ${page.url()} ===`);

  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);

  console.log("URL after submit:", page.url());

  const cookies = await context.cookies();
  const authCookies = cookies.filter((c) => /sb-|supabase|auth/i.test(c.name));
  console.log("AUTH COOKIES:", JSON.stringify(authCookies.map(c => ({
    name: c.name, domain: c.domain, path: c.path, secure: c.secure, sameSite: c.sameSite, httpOnly: c.httpOnly, expiresIn: c.expires === -1 ? "session" : Math.round(c.expires - Date.now()/1000) + "s",
  })), null, 2));

  // Now reload the same page to see if the session persists (simulates a real user coming back).
  await page.goto(startUrl.replace("/login", "/dashboard"), { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1500);
  console.log("URL after reload of /dashboard:", page.url());
  const stillLoggedIn = await page.evaluate(() => !document.body.innerText.includes("Sign in to your organization"));
  console.log("Still logged in after reload:", stillLoggedIn);
  console.log("Console errors:", JSON.stringify(consoleMsgs.slice(0, 10)));

  await page.screenshot({ path: `smoke-test-output/PROD-login-${label}-2026-08-18.png`, fullPage: false });
  await browser.close();
}

async function main() {
  // Desktop, via the non-www apex domain (what a user would likely type).
  await attempt("desktop-apex", { viewport: { width: 1440, height: 900 } }, "https://benavora.com/login");
  // Mobile emulation.
  await attempt("mobile", { ...devices["iPhone 13"] }, "https://benavora.com/login");
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
