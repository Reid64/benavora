import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const BASE = "http://localhost:3000";
const SHOT = "audit/screenshots";
const env = {}; for (const l of readFileSync(".env.local","utf8").split(/\r?\n/)){ if(!l||l.startsWith("#")||!l.includes("="))continue; const i=l.indexOf("="); env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const ORG = "bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";
const STAMP = process.env.STAMP || "C";
const out = []; const rec=(o)=>{out.push(o);console.log(JSON.stringify(o));};
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });

// CONTACTS create (corrected: Funder required, Name* label)
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "New contact" }).click(); await page.waitForTimeout(1200);
  const fsel = page.getByLabel(/Funder/); const nopt = await fsel.locator("option").count();
  if (nopt>1) await fsel.selectOption({ index: 1 });
  const cname = `Audit Contact ${STAMP}`;
  await page.getByLabel(/^Name/).fill(cname);
  await page.getByLabel(/^Title/).fill("Audit Director").catch(()=>{});
  await page.getByLabel(/^Email/).fill(`audit_${STAMP}@example.com`).catch(()=>{});
  await page.getByRole("button", { name: /create contact|save/i }).first().click();
  await page.waitForTimeout(3000);
  const { data } = await admin.from("contacts").select("id,name,title,email").eq("organization_id",ORG).eq("name",cname);
  rec({ test:"contacts.create", name:cname, dbRows:data?.length||0, dbRecord:data?.[0]||null, url:page.url() });
  await page.screenshot({ path:`${SHOT}/p3-contact-created.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"contacts.create", error:String(e).slice(0,250) }); }

// OPPORTUNITIES create
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/opportunities`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
  const addBtn = page.getByRole("button", { name: /new opportunity|add opportunity/i }).first();
  const hasAdd = await addBtn.count()>0;
  let dbRows=0, oname=`Audit Opp ${STAMP}`, urlAfter=null;
  if (hasAdd) {
    await addBtn.click(); await page.waitForTimeout(1200);
    await page.getByLabel(/Opportunity name/i).fill(oname).catch(()=>{});
    // funder select if present
    const fs2 = page.getByLabel(/Funder/i); if (await fs2.count()>0){ const n=await fs2.locator("option").count(); if(n>1) await fs2.selectOption({index:1}).catch(()=>{}); }
    await page.getByRole("button", { name: /create|save/i }).first().click().catch(()=>{});
    await page.waitForTimeout(3000);
    urlAfter = page.url();
    const { data } = await admin.from("opportunities").select("id,name").eq("organization_id",ORG).eq("name",oname);
    dbRows = data?.length||0;
  }
  rec({ test:"opportunities.create", addButtonFound:hasAdd, name:oname, dbRows, urlAfter });
  await page.screenshot({ path:`${SHOT}/p3-opportunity.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"opportunities.create", error:String(e).slice(0,250) }); }

// OPPORTUNITIES filters (status/category)
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/opportunities`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
  const rowsBefore = await page.locator("table tbody tr").count();
  const statusSel = page.getByLabel(/Filter by status/i).first();
  let filtered = null;
  if (await statusSel.count()>0){ const n=await statusSel.locator("option").count(); if(n>1){ await statusSel.selectOption({index:1}); await page.waitForTimeout(1200); filtered = await page.locator("table tbody tr").count(); } }
  rec({ test:"opportunities.filters", rowsBefore, rowsAfterStatusFilter:filtered, statusFilterPresent: await statusSel.count()>0 });
  await page.close();
} catch(e){ rec({ test:"opportunities.filters", error:String(e).slice(0,250) }); }

// KB sub-pages + entry clickability
try {
  const page = await ctx.newPage();
  const subs = { profile:"/knowledge-base/profile", narratives:"/knowledge-base/narratives", answers:"/knowledge-base/answers" };
  const res = {};
  for (const [k,p] of Object.entries(subs)){
    const resp = await page.goto(`${BASE}${p}`, { waitUntil:"networkidle" }); await page.waitForTimeout(1200);
    const txt = ((await page.locator("main").innerText().catch(()=>""))||"").replace(/\s+/g," ");
    res[k] = { http: resp?.status(), url: page.url(), textLen: txt.length, excerpt: txt.slice(0,120) };
  }
  // on narratives, attempt to click first entry/card to see if a detail/editor opens
  await page.goto(`${BASE}/knowledge-base/narratives`, { waitUntil:"networkidle" }); await page.waitForTimeout(1200);
  const before = page.url();
  const firstCard = page.locator("main a, main button, main [role='button']").first();
  let openedEditor = false;
  if (await firstCard.count()>0){ await firstCard.click().catch(()=>{}); await page.waitForTimeout(1500); openedEditor = page.url()!==before || (await page.locator("textarea, [contenteditable]").count())>0; }
  res.narrativeEntryClickable = openedEditor;
  await page.screenshot({ path:`${SHOT}/p3-kb-narratives.png`, fullPage:true });
  rec({ test:"knowledge_base.subpages", ...res });
  await page.close();
} catch(e){ rec({ test:"knowledge_base.subpages", error:String(e).slice(0,250) }); }

await browser.close();
writeFileSync("audit/phase3-ui2.json", JSON.stringify(out,null,2));
console.log("\nWrote audit/phase3-ui2.json");
