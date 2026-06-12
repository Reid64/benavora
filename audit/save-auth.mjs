// Log in fresh and save storage state (no logout afterward).
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const email = process.argv[2] || "reid@benavora.com";
const password = process.argv[3] || "test1234";
const outFile = process.argv[4] || "audit/auth-state.json";
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.fill("#email", email);
await page.fill("#password", password);
await page.click('button[type="submit"]');
try { await page.waitForURL("**/dashboard", { timeout: 20000 }); } catch {}
await page.waitForTimeout(3000);
if (!page.url().includes("/dashboard")) {
  console.error("LOGIN FAILED, url=", page.url());
  process.exit(1);
}
await ctx.storageState({ path: outFile });
console.log("Saved", outFile, "for", email);
await browser.close();
