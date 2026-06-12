import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });

// ---- OUTCOMES form deep debug ----
{
  const page = await ctx.newPage();
  const net = [];
  page.on("response", r => { if (/outcomes|rest\/v1/.test(r.url())) net.push(`${r.status()} ${r.request().method()} ${r.url().split("/rest/v1/")[1]?.slice(0,60)||r.url().slice(-40)}`); });
  page.on("console", m => { if (m.type()==="error") net.push("CONSOLE-ERR "+m.text().slice(0,160)); });
  await page.goto(`${BASE}/outcomes`, { waitUntil:"networkidle" }); await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /^record$/i }).first().click(); await page.waitForTimeout(1500);
  // dump the Outcome select options
  const sel = page.getByLabel(/Outcome/i).first();
  const opts = await sel.locator("option").allTextContents().catch(()=>[]);
  console.log("OUTCOME select options:", JSON.stringify(opts));
  // choose 'Awarded' explicitly
  await sel.selectOption({ label: opts.find(o=>/award/i.test(o)) || opts[1] }).catch(async()=>{ await sel.selectOption({index:1}); });
  await page.waitForTimeout(500);
  const labels = await page.locator("form label").allTextContents();
  console.log("FORM labels:", JSON.stringify(labels.map(s=>s.trim())));
  const amt = page.getByLabel(/Amount awarded/i).first();
  if (await amt.count()>0) await amt.fill("42000");
  net.length = 0;
  await page.getByRole("button", { name: /record outcome/i }).first().click();
  await page.waitForTimeout(4000);
  const alerts = await page.locator('[role="alert"], .text-red-700, .text-red-600').allTextContents().catch(()=>[]);
  console.log("AFTER SUBMIT alerts:", JSON.stringify(alerts.map(s=>s.trim()).filter(Boolean)));
  console.log("AFTER SUBMIT network:", JSON.stringify(net.slice(0,10)));
  console.log("URL:", page.url());
  await page.screenshot({ path:"audit/screenshots/p3-outcome-debug.png", fullPage:true });
  await page.close();
}

// ---- APPLICATION Move dialog deep debug ----
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/applications/9383cd16-917d-47b5-9b56-12623c96c7f7`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /move/i }).first().click(); await page.waitForTimeout(1200);
  // dump dialog contents
  const dialogButtons = await page.getByRole("button").allTextContents();
  console.log("MOVE dialog buttons:", JSON.stringify(dialogButtons.map(s=>s.trim()).filter(Boolean)));
  const dialogText = ((await page.locator('[role="dialog"], .modal, main').last().innerText().catch(()=>""))||"").replace(/\s+/g," ").slice(0,400);
  console.log("MOVE dialog text:", dialogText);
  const selects = await page.locator("select").count();
  const radios = await page.locator('input[type="radio"], [role="radio"]').count();
  console.log("selects:", selects, "radios:", radios);
  await page.screenshot({ path:"audit/screenshots/p3-move-dialog.png", fullPage:true });
  await page.close();
}
await browser.close();
