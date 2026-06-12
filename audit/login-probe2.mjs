import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const reqs = [];
page.on("response", async (r) => {
  const u = r.url();
  if (/token|log-event|auth\/v1|dashboard/.test(u)) {
    reqs.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, "").slice(0, 80)}`);
  }
});
page.on("console", (m) => { if (m.type() === "error") reqs.push("CONSOLE-ERR: " + m.text()); });

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.fill("#email", "reid@benavora.com");
await page.fill("#password", "test1234");
await page.click('button[type="submit"]');
await page.waitForTimeout(8000);

const cookies = await ctx.cookies();
const authCookies = cookies.filter(c => /sb-|supabase/.test(c.name)).map(c => c.name);
console.log("URL after:", page.url());
console.log("Auth cookies set:", JSON.stringify(authCookies));
console.log("Button text now:", await page.locator('button[type="submit"]').textContent().catch(()=>null));
console.log("Network/console trace:");
for (const r of reqs) console.log("  ", r);
await browser.close();
