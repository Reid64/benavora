// PHASE 3a — Authenticated sweep of all dashboard pages.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
const BASE = "http://localhost:3000";
const SHOT = "audit/screenshots";
mkdirSync(SHOT, { recursive: true });

const PAGES = [
  "dashboard","funders","contacts","opportunities","applications","automation",
  "draft-generator","documents","knowledge-base","deadlines","outcomes","settings",
  // bonus pages present in nav
  "billing","admin","research","outreach","search-profiles",
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });
const out = [];
for (const p of PAGES) {
  const page = await ctx.newPage();
  const consoleErrors = [], failed = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url().replace(BASE,"")} :: ${r.failure()?.errorText}`));
  let rec = { path: "/" + p };
  try {
    const resp = await page.goto(`${BASE}/${p}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    rec.httpStatus = resp ? resp.status() : null;
    rec.finalUrl = page.url();
    rec.redirectedToLogin = page.url().includes("/login");
    rec.h1 = (await page.locator("h1").first().textContent().catch(() => "")).trim().slice(0, 80);
    rec.tableRows = await page.locator("table tbody tr").count().catch(() => 0);
    rec.buttons = await page.locator("button").count().catch(() => 0);
    rec.links = await page.locator("a").count().catch(() => 0);
    rec.inputs = await page.locator("input,select,textarea").count().catch(() => 0);
    rec.hasErrorOverlay = await page.locator("text=/Unhandled Runtime Error|Application error/i").count().catch(() => 0) > 0;
    const bodyText = (await page.locator("main").first().innerText().catch(() => "")) || "";
    rec.bodyExcerpt = bodyText.replace(/\s+/g, " ").trim().slice(0, 240);
    rec.consoleErrors = consoleErrors.slice(0, 6);
    rec.failedRequests = failed.filter(f => !/_rsc|favicon/.test(f)).slice(0, 6);
    await page.screenshot({ path: `${SHOT}/p3-${p}.png`, fullPage: true });
  } catch (e) {
    rec.error = String(e).slice(0, 200);
  }
  out.push(rec);
  console.log(`${rec.path.padEnd(18)} ${String(rec.httpStatus).padStart(3)} h1="${rec.h1||""}" rows=${rec.tableRows} btn=${rec.buttons} in=${rec.inputs} ${rec.redirectedToLogin?"REDIR-LOGIN":""} ${rec.error?("ERR "+rec.error):""}${rec.consoleErrors&&rec.consoleErrors.length?" CONSOLE-ERR:"+rec.consoleErrors.length:""}`);
  await page.close();
}
await browser.close();
writeFileSync("audit/phase3-sweep.json", JSON.stringify(out, null, 2));
console.log("\nWrote audit/phase3-sweep.json");
