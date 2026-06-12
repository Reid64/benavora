import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "http://localhost:3000";
const SHOT = "audit/screenshots";
const env = {}; for (const l of readFileSync(".env.local","utf8").split(/\r?\n/)){ if(!l||l.startsWith("#")||!l.includes("="))continue; const i=l.indexOf("="); env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const ORG = "bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";
const out=[]; const rec=(o)=>{out.push(o);console.log(JSON.stringify(o));};
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });

// OUTCOMES record (diagnostic + real submit)
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/outcomes`, { waitUntil:"networkidle" }); await page.waitForTimeout(3000);
  const allBtns = await page.getByRole("button").allTextContents();
  const before = (await admin.from("outcomes").select("id",{count:"exact",head:true}).eq("organization_id",ORG)).count;
  // Record control may be a button labeled "Record outcome" within an eligible app row
  let recBtn = page.getByRole("button", { name: /record/i }).first();
  let found = await recBtn.count();
  let submitted=false, dbErr=null;
  if (found>0){
    await recBtn.click(); await page.waitForTimeout(1500);
    const sel = page.getByLabel(/Outcome/i).first();
    if (await sel.count()>0){ await sel.selectOption({ index:1 }).catch(()=>{}); await page.waitForTimeout(500); }
    const amt = page.getByLabel(/Amount awarded/i).first();
    if (await amt.count()>0) await amt.fill("42000").catch(()=>{});
    await page.getByRole("button", { name: /record outcome/i }).first().click().catch(()=>{});
    await page.waitForTimeout(3500);
    submitted=true;
  }
  const after = (await admin.from("outcomes").select("id,result,awarded_amount,application_id",{count:"exact"}).eq("organization_id",ORG).order("created_at",{ascending:false}).limit(2));
  rec({ test:"outcomes.record.v2", buttonsOnPage: allBtns.map(s=>s.trim()).filter(Boolean).slice(0,12), recordControlFound:found, submitted, outcomesBefore:before, outcomesAfter:after.count, newestOutcome:after.data?.[0]||null });
  await page.screenshot({ path:`${SHOT}/p3-outcomes-record.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"outcomes.record.v2", error:String(e).slice(0,250) }); }

// APPLICATIONS stage change via "Move" button
try {
  const page = await ctx.newPage();
  const APP = "9383cd16-917d-47b5-9b56-12623c96c7f7"; // drafting
  const { data:before } = await admin.from("applications").select("stage").eq("id",APP).single();
  await page.goto(`${BASE}/applications/${APP}`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
  const moveBtn = page.getByRole("button", { name: /move|advance|change stage/i }).first();
  let movePicker=false, confirmed=false;
  if (await moveBtn.count()>0){
    await moveBtn.click(); await page.waitForTimeout(1200); movePicker=true;
    // pick a target stage option (radio/button/select) different from current
    const radios = page.locator('[role="radio"], input[type="radio"], button');
    // Try a stage labeled option
    const target = page.getByText(/submitted|in review|compliance/i).first();
    if (await target.count()>0) await target.click().catch(()=>{});
    await page.waitForTimeout(500);
    const confirm = page.getByRole("button", { name: /move|confirm|save|advance/i }).last();
    if (await confirm.count()>0){ await confirm.click().catch(()=>{}); await page.waitForTimeout(2500); confirmed=true; }
  }
  const { data:after } = await admin.from("applications").select("stage").eq("id",APP).single();
  rec({ test:"applications.move", moveButtonFound: await moveBtn.count()>0, movePicker, confirmed, stageBefore:before?.stage, stageAfter:after?.stage, persisted: after?.stage!==before?.stage });
  await page.screenshot({ path:`${SHOT}/p3-app-move.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"applications.move", error:String(e).slice(0,250) }); }

await browser.close();
writeFileSync("audit/phase3-ui4.json", JSON.stringify(out,null,2));
console.log("\nWrote audit/phase3-ui4.json");
