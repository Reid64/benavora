// PHASE 2 — Authentication deep test via Playwright (chromium).
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const SHOT = "audit/screenshots";
mkdirSync(SHOT, { recursive: true });
const results = [];
function log(step, detail) { results.push({ step, ...detail }); console.log(`[${step}]`, JSON.stringify(detail)); }

const browser = await chromium.launch();

// ---------- TEST 1: protected page while logged out ----------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  log("logged_out_protected_redirect", {
    requested: "/dashboard",
    finalUrl: page.url(),
    redirectedToLogin: page.url().includes("/login"),
  });
  await page.screenshot({ path: `${SHOT}/p2-01-loggedout-redirect.png` });
  await ctx.close();
}

// ---------- TEST 2: wrong password ----------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500); // allow hydration (native GET submit otherwise)
  await page.fill("#email", "reid@benavora.com");
  await page.fill("#password", "wrongpassword123");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  const alert = await page.locator('[role="alert"]').first().textContent().catch(() => null);
  log("wrong_password", {
    finalUrl: page.url(),
    stayedOnLogin: page.url().includes("/login"),
    errorShown: alert ? alert.trim() : null,
  });
  await page.screenshot({ path: `${SHOT}/p2-02-wrong-password.png` });
  await ctx.close();
}

// ---------- TEST 3: correct login ----------
let storageState = null;
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500); // allow hydration
  await page.fill("#email", "reid@benavora.com");
  await page.fill("#password", "test1234");
  await page.click('button[type="submit"]');
  // Wait for navigation to dashboard
  let reachedDash = false;
  try {
    await page.waitForURL("**/dashboard", { timeout: 15000 });
    reachedDash = true;
  } catch { /* fall through */ }
  await page.waitForTimeout(2000);
  const h1 = await page.locator("h1").first().textContent().catch(() => null);
  const alert = await page.locator('[role="alert"]').first().textContent().catch(() => null);
  log("correct_login", {
    finalUrl: page.url(),
    reachedDashboard: reachedDash || page.url().includes("/dashboard"),
    h1: h1 ? h1.trim() : null,
    errorShown: alert ? alert.trim() : null,
  });
  await page.screenshot({ path: `${SHOT}/p2-03-login-dashboard.png`, fullPage: true });
  if (page.url().includes("/dashboard")) {
    storageState = await ctx.storageState();
    writeFileSync("audit/auth-state.json", JSON.stringify(storageState));
    console.log("Saved authenticated storage state -> audit/auth-state.json");
  }
  await ctx.close();
}

// ---------- TEST 4: logout destroys session ----------
if (storageState) {
  const ctx = await browser.newContext({ storageState });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const onDash = page.url().includes("/dashboard");
  // Find a logout control
  const logout = page.getByText(/log ?out|sign ?out/i).first();
  let clicked = false;
  if (await logout.count() > 0) {
    await logout.click().catch(() => {});
    clicked = true;
    await page.waitForTimeout(2500);
  }
  const afterLogoutUrl = page.url();
  // Now try to revisit dashboard in same context — should redirect to login
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  log("logout_session_destroyed", {
    wasOnDashboard: onDash,
    logoutControlFound: clicked,
    urlAfterLogout: afterLogoutUrl,
    revisitDashboardUrl: page.url(),
    sessionDestroyed: page.url().includes("/login"),
  });
  await page.screenshot({ path: `${SHOT}/p2-04-after-logout.png` });
  await ctx.close();
}

// ---------- TEST 5: registration flow (new test user) ----------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const ts = process.env.TS_STAMP || "00000";
  const email = `audit_test_${ts}@example.com`;
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500); // allow hydration
  await page.fill("#organizationName", `Audit Test Org ${ts}`).catch(() => {});
  await page.fill("#fullName", "Audit Tester").catch(() => {});
  await page.fill("#email", email).catch(() => {});
  await page.fill("#password", "test1234").catch(() => {});
  await page.fill("#confirmPassword", "test1234").catch(() => {});
  await page.click('button[type="submit"]').catch(() => {});
  await page.waitForTimeout(4000);
  const alert = await page.locator('[role="alert"]').first().textContent().catch(() => null);
  log("registration", {
    email,
    finalUrl: page.url(),
    reachedOnboardingOrDash: /onboarding|dashboard/.test(page.url()),
    errorShown: alert ? alert.trim() : null,
  });
  await page.screenshot({ path: `${SHOT}/p2-05-registration.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
writeFileSync("audit/phase2-results.json", JSON.stringify(results, null, 2));
console.log("\nWrote audit/phase2-results.json");
