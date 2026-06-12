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
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });

// OUTCOME happy path: record on the SUBMITTED app (a2b21cd2 — no existing outcome)
try {
  const APP="a2b21cd2-6e63-41d7-9d6d-541c4fb0ca73"; // submitted, no outcome
  const page = await ctx.newPage();
  await page.goto(`${BASE}/outcomes`, { waitUntil:"networkidle" }); await page.waitForTimeout(3000);
  const before=(await admin.from("outcomes").select("id",{count:"exact",head:true}).eq("application_id",APP)).count;
  // The eligible apps are listed; find the Record button in the row containing this app's opportunity.
  // We click each Record until the dialog's hidden app matches; simpler: click the Record whose card mentions "submitted".
  // Strategy: open each Record, check, but to keep deterministic, click the LAST Record (apps usually ordered).
  const recordBtns = page.getByRole("button", { name: /^record$/i });
  const n = await recordBtns.count();
  let made=null;
  for (let i=0;i<n;i++){
    await recordBtns.nth(i).click(); await page.waitForTimeout(1200);
    const sel = page.locator('div[role="dialog"] select').first();
    if (await sel.count()===0){ continue; }
    await sel.selectOption({ label:"Awarded" }).catch(()=>{});
    await page.waitForTimeout(300);
    const amt = page.locator('div[role="dialog"]').getByLabel(/Amount awarded/i).first();
    if (await amt.count()>0) await amt.fill("55000");
    await page.locator('div[role="dialog"]').getByRole("button",{name:/record outcome/i}).first().click();
    await page.waitForTimeout(3000);
    const alert = await page.locator('div[role="dialog"] [role="alert"], [role="alert"]').allTextContents().catch(()=>[]);
    const conflict = alert.join(" ").includes("already been recorded");
    const dialogGone = await page.locator('div[role="dialog"]').count()===0;
    if (dialogGone && !conflict){ made="success-or-other"; break; }
    // close dialog if still open (conflict) and try next
    const cancel = page.locator('div[role="dialog"]').getByRole("button",{name:/cancel/i}).first();
    if (await cancel.count()>0) await cancel.click().catch(()=>{});
    await page.waitForTimeout(500);
  }
  const after=(await admin.from("outcomes").select("id,result,awarded_amount,organization_id,application_id",{count:"exact"}).eq("application_id",APP));
  rec({ test:"outcomes.happy_path", app:APP, recordButtons:n, outcomesForAppBefore:before, outcomesForAppAfter:after.count, created:after.data?.[0]||null, createdUnderCorrectOrg: after.data?.[0]?.organization_id===ORG });
  await page.screenshot({ path:`${SHOT}/p3-outcome-happy.png`, fullPage:true });
  await page.close();
} catch(e){ rec({ test:"outcomes.happy_path", error:String(e).slice(0,300) }); }

// MOVE: backward move with mandatory note (deterministic), verify stage + pipeline_history
try {
  const APP="9383cd16-917d-47b5-9b56-12623c96c7f7"; // drafting
  const page = await ctx.newPage();
  const {data:before}=await admin.from("applications").select("stage").eq("id",APP).single();
  const phBefore=(await admin.from("pipeline_history").select("id",{count:"exact",head:true}).eq("application_id",APP)).count;
  await page.goto(`${BASE}/applications/${APP}`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
  await page.getByRole("button",{name:/move/i}).first().click(); await page.waitForTimeout(1000);
  const dlg = page.locator('div[role="dialog"]').first();
  await dlg.locator("select").first().selectOption({ label:"Qualified" }); // backward from drafting
  await page.waitForTimeout(600);
  // note textarea required for backward
  const note = dlg.locator("textarea").first();
  if (await note.count()>0) await note.fill("Audit test: moving back to re-qualify.");
  await dlg.getByRole("button",{name:/confirm move/i}).click();
  await page.waitForTimeout(3000);
  const {data:after}=await admin.from("applications").select("stage").eq("id",APP).single();
  const phAfter=(await admin.from("pipeline_history").select("id",{count:"exact",head:true}).eq("application_id",APP)).count;
  rec({ test:"applications.move.backward_with_note", stageBefore:before?.stage, stageAfter:after?.stage, persisted:after?.stage!==before?.stage, pipelineHistoryBefore:phBefore, pipelineHistoryAfter:phAfter, historyRowAdded:phAfter>phBefore });
  await page.screenshot({ path:`${SHOT}/p3-move-success.png`, fullPage:true });
  // restore to drafting for cleanliness
  if (after?.stage!==before?.stage) await admin.from("applications").update({ stage: before.stage }).eq("id",APP);
  await page.close();
} catch(e){ rec({ test:"applications.move.backward_with_note", error:String(e).slice(0,300) }); }

await browser.close();
writeFileSync("audit/phase3-final.json", JSON.stringify(out,null,2));
console.log("\nWrote audit/phase3-final.json");
