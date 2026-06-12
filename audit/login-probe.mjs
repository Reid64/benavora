import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleMsgs = [], failed = [], pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleMsgs.push(m.text()); });
page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000); // allow hydration

// Probe hydration: React controls the input via onChange; type and read back.
await page.fill("#email", "reid@benavora.com");
await page.fill("#password", "test1234");
const emailVal = await page.inputValue("#email");

// Check if the submit triggers React (preventDefault) or native GET.
const urlBefore = page.url();
await page.click('button[type="submit"]');
// Give it time either to navigate (native) or to do the async signin
await page.waitForTimeout(6000);
const urlAfter = page.url();

console.log(JSON.stringify({
  emailValueRetained: emailVal,
  urlBefore, urlAfter,
  nativeGetSubmit: urlAfter.includes("?email="),
  reachedDashboard: urlAfter.includes("/dashboard"),
  consoleErrors: consoleMsgs.slice(0, 15),
  pageErrors: pageErrors.slice(0, 10),
  failedRequests: failed.filter(f => /\.js|_rsc|login/.test(f)).slice(0, 20),
}, null, 2));

await page.screenshot({ path: "audit/screenshots/p2-login-probe.png", fullPage: true });
await browser.close();
