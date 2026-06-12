import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "http://localhost:3000";
const SHOT = "audit/screenshots";
const env = {}; for (const l of readFileSync(".env.local","utf8").split(/\r?\n/)){ if(!l||l.startsWith("#")||!l.includes("="))continue; const i=l.indexOf("="); env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const ORG="bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";
const out=[]; const rec=(o)=>{out.push(o);console.log(JSON.stringify(o));};
const browser = await chromium.launch();

// ---------- PHASE 5: ORG ISOLATION (user2) ----------
try {
  const ctx = await browser.newContext({ storageState: "audit/auth-state-user2.json" });
  const page = await ctx.newPage();
  const faithFunders = (await admin.from("funders").select("name").eq("organization_id",ORG)).data?.map(f=>f.name)||[];
  const pages = {};
  for (const p of ["funders","contacts","opportunities"]) {
    await page.goto(`${BASE}/${p}`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
    const rows = await page.locator("table tbody tr").count();
    const bodyText = (await page.locator("main").innerText().catch(()=>""))||"";
    const leakedNames = faithFunders.filter(n=>n&&bodyText.includes(n));
    pages[p] = { tableRows: rows, faithDataLeaked: leakedNames };
  }
  rec({ test:"phase5.org_isolation", asUser:"audit_test_04225@example.com (empty org)", faithFunderCount:faithFunders.length, pages, isolationHolds: Object.values(pages).every(x=>x.faithDataLeaked.length===0) });
  await page.screenshot({ path:`${SHOT}/p5-isolation-user2-funders.png`, fullPage:true });
  await ctx.close();
} catch(e){ rec({ test:"phase5.org_isolation", error:String(e).slice(0,300) }); }

// ---------- reid context for the rest ----------
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });

// SETTINGS feature flags (read-only?) + team
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings`, { waitUntil:"networkidle" }); await page.waitForTimeout(2000);
  const switches = await page.locator('[role="switch"], input[type="checkbox"]').count();
  const flagBadges = await page.locator("main").getByText(/Enabled|Disabled/).allTextContents().catch(()=>[]);
  const inviteBtn = await page.getByRole("button",{name:/invite/i}).count();
  const teamRows = await page.locator("main").getByText(/reid@benavora\.com|owner/i).count();
  rec({ test:"phase3.settings_flags_team", toggleControls:switches, flagBadgeCount:flagBadges.length, flagBadgesSample:flagBadges.slice(0,8), inviteButtonPresent:inviteBtn>0, teamRosterVisible:teamRows>0 });
  await page.screenshot({ path:`${SHOT}/p3-settings-flags.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"phase3.settings_flags_team", error:String(e).slice(0,300) }); }

// AUTOMATION page — disabled then enabled
try {
  const page = await ctx.newPage();
  await admin.from("platform_config").update({ value:"false" }).eq("organization_id",ORG).eq("key","feature.browser_automation");
  await page.goto(`${BASE}/automation`, { waitUntil:"networkidle" }); await page.waitForTimeout(1800);
  const disabledText = ((await page.locator("main").innerText().catch(()=>""))||"").replace(/\s+/g," ").slice(0,300);
  // enable flag via service role
  await admin.from("platform_config").update({ value:"true" }).eq("organization_id",ORG).eq("key","feature.browser_automation");
  await page.goto(`${BASE}/automation`, { waitUntil:"networkidle" }); await page.waitForTimeout(1800);
  const enabledText = ((await page.locator("main").innerText().catch(()=>""))||"").replace(/\s+/g," ").slice(0,300);
  const enabledButtons = (await page.getByRole("button").allTextContents()).map(s=>s.trim()).filter(Boolean);
  const urlInputs = await page.locator('input[type="url"], input[placeholder*="http" i], input[placeholder*="url" i]').count();
  rec({ test:"phase3.automation", disabledStateText:disabledText, enabledStateText:enabledText, enabledButtons:enabledButtons.slice(0,12), urlInputPresent:urlInputs>0, uiChangedOnEnable: disabledText!==enabledText });
  await page.screenshot({ path:`${SHOT}/p3-automation-enabled.png`, fullPage:true });
  // revert
  await admin.from("platform_config").update({ value:"false" }).eq("organization_id",ORG).eq("key","feature.browser_automation");
  await page.close();
} catch(e){ rec({ test:"phase3.automation", error:String(e).slice(0,300) }); }

// OUTCOMES analytics render
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/outcomes`, { waitUntil:"networkidle" }); await page.waitForTimeout(2500);
  const aBtn = page.getByRole("button",{name:/analytics/i}).first();
  let clicked=false, charts=0, txt="";
  if (await aBtn.count()>0){ await aBtn.click().catch(()=>{}); await page.waitForTimeout(2000); clicked=true; }
  charts = await page.locator("svg, canvas").count();
  txt = ((await page.locator("main").innerText().catch(()=>""))||"").replace(/\s+/g," ").slice(0,260);
  rec({ test:"phase3.outcomes_analytics", analyticsButton:await aBtn.count()>0, clicked, svgOrCanvasCount:charts, excerpt:txt });
  await page.screenshot({ path:`${SHOT}/p3-outcomes-analytics.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"phase3.outcomes_analytics", error:String(e).slice(0,300) }); }

// AUDIT LOG page + DB growth
try {
  const page = await ctx.newPage();
  const resp = await page.goto(`${BASE}/admin/audit-log`, { waitUntil:"networkidle" }); await page.waitForTimeout(2000);
  const rows = await page.locator("table tbody tr").count();
  const { count: dbCount } = await admin.from("audit_logs").select("*",{count:"exact",head:true}).eq("organization_id",ORG);
  const { data: recent } = await admin.from("audit_logs").select("action,entity_type,created_at").eq("organization_id",ORG).order("created_at",{ascending:false}).limit(5);
  rec({ test:"phase5.audit_log", http:resp?.status(), tableRows:rows, dbAuditCount:dbCount, recentActions:recent });
  await page.screenshot({ path:`${SHOT}/p5-audit-log.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"phase5.audit_log", error:String(e).slice(0,300) }); }

await ctx.close();
await browser.close();
writeFileSync("audit/phase35-results.json", JSON.stringify(out,null,2));
console.log("\nWrote audit/phase35-results.json");
