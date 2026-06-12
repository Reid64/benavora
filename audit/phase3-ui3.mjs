import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "http://localhost:3000";
const SHOT = "audit/screenshots";
const env = {}; for (const l of readFileSync(".env.local","utf8").split(/\r?\n/)){ if(!l||l.startsWith("#")||!l.includes("="))continue; const i=l.indexOf("="); env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const ORG = "bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";
const STAMP = process.env.STAMP || "D";
const out=[]; const rec=(o)=>{out.push(o);console.log(JSON.stringify(o));};
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });

// OPPORTUNITY create with category set
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/opportunities`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /new opportunity|add opportunity/i }).first().click(); await page.waitForTimeout(1200);
  const oname = `Audit Opp ${STAMP}`;
  await page.getByLabel(/Opportunity name/i).fill(oname);
  const cat = page.getByLabel(/^Category/i); if (await cat.locator("option").count()>1) await cat.selectOption({ index:1 });
  const fund = page.getByLabel(/^Funder/i); if (await fund.count()>0 && await fund.locator("option").count()>1) await fund.selectOption({ index:1 }).catch(()=>{});
  await page.getByRole("button", { name: /create|save/i }).first().click(); await page.waitForTimeout(3000);
  const { data } = await admin.from("opportunities").select("id,name,category").eq("organization_id",ORG).eq("name",oname);
  rec({ test:"opportunities.create.v2", name:oname, dbRows:data?.length||0, dbRecord:data?.[0]||null, url:page.url() });
  await page.screenshot({ path:`${SHOT}/p3-opp-created.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"opportunities.create.v2", error:String(e).slice(0,250) }); }

// OUTCOMES: record via UI on an app without an existing outcome
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/outcomes`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
  const outcomesBefore = (await admin.from("outcomes").select("id",{count:"exact",head:true}).eq("organization_id",ORG)).count;
  const recordBtns = page.getByRole("button", { name: /^record/i });
  const nRecord = await recordBtns.count();
  let submitted=false, analyticsRendered=null;
  if (nRecord>0){
    await recordBtns.first().click(); await page.waitForTimeout(1200);
    // outcome select -> awarded; amount
    const sel = page.getByLabel(/Outcome/i).first();
    if (await sel.count()>0) await sel.selectOption({ label:/awarded/i }).catch(async()=>{ await sel.selectOption({index:1}).catch(()=>{}); });
    const amt = page.getByLabel(/Amount awarded/i).first();
    if (await amt.count()>0) await amt.fill("42000").catch(()=>{});
    await page.getByRole("button", { name: /record outcome|save/i }).first().click().catch(()=>{});
    await page.waitForTimeout(3000);
    submitted=true;
  }
  const outcomesAfter = (await admin.from("outcomes").select("id,awarded_amount,result,status",{count:"exact"}).eq("organization_id",ORG).order("created_at",{ascending:false}).limit(2));
  // View Analytics
  const analyticsBtn = page.getByRole("button", { name: /analytics/i }).first();
  if (await analyticsBtn.count()>0){ await analyticsBtn.click().catch(()=>{}); await page.waitForTimeout(1500); analyticsRendered = (await page.locator("svg, canvas, [class*=chart]").count())>0; }
  rec({ test:"outcomes.record", recordButtons:nRecord, submitted, outcomesBefore, outcomesAfter:outcomesAfter.count, newestOutcome:outcomesAfter.data?.[0]||null, analyticsRendered });
  await page.screenshot({ path:`${SHOT}/p3-outcomes.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"outcomes.record", error:String(e).slice(0,250) }); }

// APPLICATION detail stage change -> DB (complements failed drag)
try {
  const page = await ctx.newPage();
  const APP = "9383cd16-917d-47b5-9b56-12623c96c7f7"; // drafting
  const { data: before } = await admin.from("applications").select("stage").eq("id",APP).single();
  await page.goto(`${BASE}/applications/${APP}`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
  const onDetail = !page.url().includes("/login") && page.url().includes(APP);
  // find a stage <select> and change it
  const stageSel = page.locator("select").first();
  let changed=false, picked=null;
  if (await stageSel.count()>0){
    const opts = await stageSel.locator("option").allTextContents();
    // pick an option different from current
    const idx = opts.findIndex((o,i)=> i>0 && !new RegExp(before.stage,"i").test(o));
    if (idx>=0){ picked=opts[idx]; await stageSel.selectOption({ index: idx }); await page.waitForTimeout(2500); changed=true; }
  }
  const { data: after } = await admin.from("applications").select("stage,updated_at").eq("id",APP).single();
  rec({ test:"applications.stage_change_detail", onDetail, stageBefore:before?.stage, pickedOption:picked, stageAfter:after?.stage, persisted: after?.stage!==before?.stage });
  await page.screenshot({ path:`${SHOT}/p3-app-detail.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"applications.stage_change_detail", error:String(e).slice(0,250) }); }

// DASHBOARD stat cards / links navigation
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
  const links = await page.locator("main a").evaluateAll(els=>els.map(e=>({t:e.textContent.trim().slice(0,40),href:e.getAttribute("href")})).filter(l=>l.href&&l.href.startsWith("/")));
  // click first internal link and confirm navigation
  let navOk=null, navTarget=null;
  if (links.length>0){ const h=links[0].href; navTarget=h; await page.locator(`main a[href="${h}"]`).first().click().catch(()=>{}); await page.waitForTimeout(1500); navOk=page.url().includes(h); }
  rec({ test:"dashboard.cards", internalLinks:links.slice(0,12), firstLinkNavTarget:navTarget, firstLinkNavOk:navOk });
  await page.close();
} catch(e){ rec({ test:"dashboard.cards", error:String(e).slice(0,250) }); }

await browser.close();
writeFileSync("audit/phase3-ui3.json", JSON.stringify(out,null,2));
console.log("\nWrote audit/phase3-ui3.json");
