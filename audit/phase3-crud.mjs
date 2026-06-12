// PHASE 3b — Deep CRUD with DB persistence verification.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const BASE = "http://localhost:3000";
const SHOT = "audit/screenshots"; mkdirSync(SHOT, { recursive: true });
const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { if (!l||l.startsWith("#")||!l.includes("="))continue; const i=l.indexOf("="); env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ORG = "bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";
const STAMP = process.env.STAMP || "X";
const out = [];
const rec = (o) => { out.push(o); console.log(JSON.stringify(o)); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });

// ---------------- FUNDERS: create + DB verify ----------------
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/funders`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const funderName = `Audit Funder ${STAMP}`;
  await page.getByRole("button", { name: /new funder|add funder/i }).first().click();
  await page.waitForTimeout(1000);
  await page.getByLabel("Funder name").fill(funderName);
  // Category select — choose the second option (first is placeholder)
  const cat = page.getByLabel("Category");
  const opts = await cat.locator("option").allTextContents().catch(() => []);
  if (opts.length > 1) await cat.selectOption({ index: 1 }).catch(() => {});
  await page.getByLabel("Geographic focus").fill("Audit Test Region").catch(() => {});
  await page.getByLabel("Website").fill("https://audit.example.com").catch(() => {});
  await page.getByRole("button", { name: /create funder|save anyway/i }).first().click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOT}/p3-funder-create.png`, fullPage: true });
  // Verify in table
  const inTable = await page.getByText(funderName).count().catch(() => 0);
  // Verify in DB
  const { data: dbRow } = await admin.from("funders").select("id,name,category,geographic_focus").eq("organization_id", ORG).eq("name", funderName);
  rec({ test: "funders.create", funderName, categoryOptions: opts.slice(0,6), appearsInTable: inTable > 0, dbRows: dbRow?.length || 0, dbRecord: dbRow?.[0] || null, finalUrl: page.url() });
  await page.close();
} catch (e) { rec({ test: "funders.create", error: String(e).slice(0, 300) }); }

// ---------------- FUNDERS: search + sort ----------------
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/funders`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const rowsBefore = await page.locator("table tbody tr").count();
  const search = page.getByPlaceholder(/search funders/i).first();
  await search.fill("Brightwater");
  await page.waitForTimeout(1500);
  const rowsFiltered = await page.locator("table tbody tr").count();
  await search.fill("");
  await page.waitForTimeout(800);
  // sort: click first sortable column header
  const header = page.locator("table thead th button, table thead th").first();
  await header.click().catch(() => {});
  await page.waitForTimeout(800);
  const rowsAfterSort = await page.locator("table tbody tr").count();
  rec({ test: "funders.search_sort", rowsBefore, rowsFiltered_Brightwater: rowsFiltered, searchNarrows: rowsFiltered < rowsBefore, rowsAfterSort });
  await page.close();
} catch (e) { rec({ test: "funders.search_sort", error: String(e).slice(0, 300) }); }

// ---------------- FUNDERS: edit detail + DB verify ----------------
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/funders`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  // click the audit funder row to open detail
  await page.getByText(`Audit Funder ${STAMP}`).first().click().catch(() => {});
  await page.waitForTimeout(2000);
  const onDetail = page.url();
  // Try to edit the notes/geographic field if an edit affordance exists
  const newGeo = `Edited Region ${STAMP}`;
  let edited = false;
  const geo = page.getByLabel("Geographic focus");
  if (await geo.count() > 0) {
    await geo.fill(newGeo);
    await page.getByRole("button", { name: /save/i }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    edited = true;
  }
  const { data: dbRow } = await admin.from("funders").select("geographic_focus").eq("organization_id", ORG).eq("name", `Audit Funder ${STAMP}`);
  rec({ test: "funders.edit", detailUrl: onDetail, editAttempted: edited, dbGeographicFocus: dbRow?.[0]?.geographic_focus || null, persistedEdit: dbRow?.[0]?.geographic_focus === newGeo });
  await page.screenshot({ path: `${SHOT}/p3-funder-detail.png`, fullPage: true });
  await page.close();
} catch (e) { rec({ test: "funders.edit", error: String(e).slice(0, 300) }); }

// ---------------- SETTINGS: change org name, save, reload, DB verify ----------------
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const { data: orgBefore } = await admin.from("organizations").select("name").eq("id", ORG).single();
  const newOrgName = `FAITH Foundation ${STAMP}`;
  // find org name input
  const orgInput = page.getByLabel(/organization name|org name/i).first();
  let found = await orgInput.count() > 0;
  if (!found) {
    // fallback: first text input on settings
    const first = page.locator('input[type="text"]').first();
    await first.fill(newOrgName).catch(() => {});
  } else {
    await orgInput.fill(newOrgName);
  }
  await page.getByRole("button", { name: /save|update/i }).first().click().catch(() => {});
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const reloadedVal = await page.getByLabel(/organization name|org name/i).first().inputValue().catch(() => null);
  const { data: orgAfter } = await admin.from("organizations").select("name").eq("id", ORG).single();
  rec({ test: "settings.org_name", orgNameBefore: orgBefore?.name, attemptedNewName: newOrgName, orgNameInDbAfter: orgAfter?.name, persistedToDb: orgAfter?.name === newOrgName, reloadedInputValue: reloadedVal, orgNameInputFound: found });
  await page.screenshot({ path: `${SHOT}/p3-settings.png`, fullPage: true });
  // restore original name to avoid polluting
  if (orgAfter?.name === newOrgName && orgBefore?.name) await admin.from("organizations").update({ name: orgBefore.name }).eq("id", ORG);
  await page.close();
} catch (e) { rec({ test: "settings.org_name", error: String(e).slice(0, 300) }); }

await browser.close();
writeFileSync("audit/phase3-crud.json", JSON.stringify(out, null, 2));
console.log("\nWrote audit/phase3-crud.json");
