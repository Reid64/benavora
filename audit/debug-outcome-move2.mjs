import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3000";
const env = {}; for (const l of readFileSync(".env.local","utf8").split(/\r?\n/)){ if(!l||l.startsWith("#")||!l.includes("="))continue; const i=l.indexOf("="); env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const ORG="bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });

// OUTCOMES: precise select targeting
{
  const page = await ctx.newPage();
  const net=[]; page.on("response", r=>{ if(/rest\/v1\/outcomes/.test(r.url())) net.push(`${r.status()} ${r.request().method()}`); });
  page.on("console", m=>{ if(m.type()==="error") net.push("CERR "+m.text().slice(0,120)); });
  await page.goto(`${BASE}/outcomes`, { waitUntil:"networkidle" }); await page.waitForTimeout(3000);
  const before=(await admin.from("outcomes").select("id",{count:"exact",head:true}).eq("organization_id",ORG)).count;
  await page.getByRole("button",{name:/^record$/i}).first().click(); await page.waitForTimeout(1500);
  const sel = page.locator('div[role="dialog"] select').first();
  await sel.selectOption({ label: "Awarded" });
  await page.waitForTimeout(400);
  const amt = page.locator('div[role="dialog"]').getByLabel(/Amount awarded/i).first();
  if (await amt.count()>0) await amt.fill("42000");
  await page.locator('div[role="dialog"]').getByRole("button",{name:/record outcome/i}).first().click();
  await page.waitForTimeout(4000);
  const after=(await admin.from("outcomes").select("id,result,awarded_amount,application_id",{count:"exact"}).eq("organization_id",ORG).order("created_at",{ascending:false}).limit(1));
  const alerts=await page.locator('[role="alert"]').allTextContents().catch(()=>[]);
  console.log("OUTCOME before:",before,"after:",after.count,"newest:",JSON.stringify(after.data?.[0]||null));
  console.log("OUTCOME net:",JSON.stringify(net),"alerts:",JSON.stringify(alerts.map(s=>s.trim()).filter(Boolean)));
  await page.close();
}

// MOVE dialog structure + drive it
{
  const page = await ctx.newPage();
  const APP="9383cd16-917d-47b5-9b56-12623c96c7f7";
  const {data:before}=await admin.from("applications").select("stage").eq("id",APP).single();
  await page.goto(`${BASE}/applications/${APP}`, { waitUntil:"networkidle" }); await page.waitForTimeout(1500);
  await page.getByRole("button",{name:/move/i}).first().click(); await page.waitForTimeout(1200);
  const dlg = page.locator('div[role="dialog"]').first();
  const selCount = await dlg.locator("select").count();
  const optionTexts = selCount>0 ? await dlg.locator("select option").allTextContents() : [];
  const btns = await dlg.getByRole("button").allTextContents();
  console.log("MOVE dialog selects:",selCount,"options:",JSON.stringify(optionTexts),"buttons:",JSON.stringify(btns.map(s=>s.trim()).filter(Boolean)));
  // if a select, pick a different stage and confirm
  let persisted=false;
  if (selCount>0){
    const target = optionTexts.find(o=>/submitted|review|compliance/i.test(o)) || optionTexts[optionTexts.length-1];
    await dlg.locator("select").first().selectOption({ label: target }).catch(()=>{});
    await page.waitForTimeout(400);
    await dlg.getByRole("button",{name:/move|confirm|save|advance/i}).last().click().catch(()=>{});
    await page.waitForTimeout(2500);
    const {data:after}=await admin.from("applications").select("stage").eq("id",APP).single();
    persisted = after?.stage!==before?.stage;
    console.log("MOVE stageBefore:",before?.stage,"target:",target,"stageAfter:",after?.stage,"persisted:",persisted);
  } else {
    console.log("MOVE: no select in dialog; buttons-based picker");
  }
  await page.screenshot({ path:"audit/screenshots/p3-move-dialog.png", fullPage:true });
  await page.close();
}
await browser.close();
