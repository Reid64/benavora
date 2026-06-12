// Benavora page audit: login, visit every dashboard page, screenshot, and
// capture what renders (heading, visible error banners, console errors, failed
// network requests, final URL after any redirect).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const EMAIL = "reid@benavora.com";
const PASSWORD = "test1234";
const OUT = "audit/screenshots";
mkdirSync(OUT, { recursive: true });

const PAGES = [
  "/dashboard",
  "/funders",
  "/contacts",
  "/opportunities",
  "/applications",
  "/automation",
  "/draft-generator",
  "/documents",
  "/knowledge-base",
  "/deadlines",
  "/outcomes",
  "/settings",
];

const results = [];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ---- Login ---------------------------------------------------------------
const loginReport = { step: "login", email: EMAIL };
try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for either redirect to dashboard or an error banner.
  await page.waitForTimeout(4000);
  loginReport.urlAfter = page.url();
  const alert = await page.locator('[role="alert"]').first();
  loginReport.errorBanner = (await alert.count()) > 0 ? (await alert.innerText()).trim() : null;
  loginReport.success = page.url().includes("/dashboard");
  await page.screenshot({ path: `${OUT}/00-login.png`, fullPage: true });
} catch (e) {
  loginReport.error = String(e);
  loginReport.success = false;
}
results.push(loginReport);
console.log("LOGIN:", JSON.stringify(loginReport));

// ---- Visit each page -----------------------------------------------------
for (const path of PAGES) {
  const r = { path, consoleErrors: [], failedRequests: [] };
  const onConsole = (msg) => {
    if (msg.type() === "error") r.consoleErrors.push(msg.text().slice(0, 300));
  };
  const onFailed = (req) =>
    r.failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? "?"}`);
  const onResponse = (resp) => {
    const s = resp.status();
    if (s >= 400) r.failedRequests.push(`${s} ${resp.request().method()} ${resp.url()}`);
  };
  page.on("console", onConsole);
  page.on("requestfailed", onFailed);
  page.on("response", onResponse);

  try {
    const resp = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 });
    r.httpStatus = resp?.status() ?? null;
    await page.waitForTimeout(1500);
    r.finalUrl = page.url();
    r.redirected = !page.url().includes(path);

    // Heading (h1) text
    const h1 = page.locator("h1").first();
    r.h1 = (await h1.count()) > 0 ? (await h1.innerText()).trim().slice(0, 120) : null;

    // Visible error banners / next.js error overlay
    const alert = page.locator('[role="alert"]').first();
    r.alert = (await alert.count()) > 0 ? (await alert.innerText()).trim().slice(0, 300) : null;

    // Next.js runtime error overlay (dev) — portal with this attribute
    const overlay = page.locator("nextjs-portal");
    r.nextErrorOverlay = (await overlay.count()) > 0;

    // Detect common empty-state vs content. Count interactive/content markers.
    const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
    r.bodyLen = bodyText.length;
    r.bodyExcerpt = bodyText.slice(0, 400);
    r.tableRows = await page.locator("table tbody tr").count();
    r.buttons = await page.locator("button").count();

    const safe = path.replace(/\//g, "_");
    await page.screenshot({ path: `${OUT}/page${safe}.png`, fullPage: true });
  } catch (e) {
    r.error = String(e).slice(0, 400);
    try {
      const safe = path.replace(/\//g, "_");
      await page.screenshot({ path: `${OUT}/page${safe}.png`, fullPage: true });
    } catch {}
  }

  page.off("console", onConsole);
  page.off("requestfailed", onFailed);
  page.off("response", onResponse);
  results.push(r);
  console.log("PAGE", path, "->", r.httpStatus, "h1:", r.h1, "errs:", r.consoleErrors.length, "failed:", r.failedRequests.length);
}

writeFileSync("audit/page-results.json", JSON.stringify(results, null, 2));
await browser.close();
console.log("\nDONE. Wrote audit/page-results.json");
