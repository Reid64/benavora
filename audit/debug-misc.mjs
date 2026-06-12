import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
const BASE = "http://localhost:3000";
const env = {}; for (const l of readFileSync(".env.local","utf8").split(/\r?\n/)){ if(!l||l.startsWith("#")||!l.includes("="))continue; const i=l.indexOf("="); env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const ORG = "bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";

// 1. Service-role upload attempt to expected bucket
const buf = Buffer.from("test");
const up = await admin.storage.from(`org-${ORG}`).upload(`audit/test_${Date.now()}.txt`, buf);
console.log("SVC upload to org-"+ORG.slice(0,8)+":", up.error ? ("ERR "+up.error.message) : "OK "+JSON.stringify(up.data));

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });

// 2. Documents UI upload error
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/documents`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.locator('input[type="file"]').first().setInputFiles(path.resolve("audit/test-upload.txt"));
  await page.waitForTimeout(5000);
  const errBanner = await page.locator('[role="alert"], .text-red-700, .text-red-600').allTextContents().catch(()=>[]);
  console.log("DOCS UI error banners:", JSON.stringify(errBanner.map(s=>s.trim()).filter(Boolean).slice(0,4)));
  await page.screenshot({ path: "audit/screenshots/p3-documents-uploaderr.png", fullPage: true });
  await page.close();
}

// 3. Contacts form debug
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const btns = await page.getByRole("button").allTextContents();
  console.log("CONTACTS buttons:", JSON.stringify(btns.map(s=>s.trim()).filter(Boolean)));
  // click first button that looks like add/new
  const addBtn = page.getByRole("button", { name: /new|add|contact/i }).first();
  if (await addBtn.count()>0) { await addBtn.click().catch(()=>{}); await page.waitForTimeout(1500); }
  const labels = await page.locator("label").allTextContents();
  console.log("CONTACTS form labels after click:", JSON.stringify(labels.map(s=>s.trim()).filter(Boolean).slice(0,15)));
  await page.screenshot({ path: "audit/screenshots/p3-contacts-form.png", fullPage: true });
  await page.close();
}

// 4. KB nav structure
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/knowledge-base`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const links = await page.locator("main a").evaluateAll(els => els.map(e => ({ t: e.textContent.trim().slice(0,30), href: e.getAttribute("href") })));
  console.log("KB main links:", JSON.stringify(links.filter(l=>l.t).slice(0,20)));
  const cardClicks = await page.locator("main button").allTextContents();
  console.log("KB buttons:", JSON.stringify(cardClicks.map(s=>s.trim()).filter(Boolean).slice(0,15)));
  await page.close();
}
await browser.close();
