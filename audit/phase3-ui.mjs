// PHASE 3c — Remaining UI flows with DB/storage verification (non-AI).
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const BASE = "http://localhost:3000";
const SHOT = "audit/screenshots"; mkdirSync(SHOT, { recursive: true });
const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { if (!l||l.startsWith("#")||!l.includes("="))continue; const i=l.indexOf("="); env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ORG = "bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";
const STAMP = process.env.STAMP || "Z";
const out = []; const rec = (o) => { out.push(o); console.log(JSON.stringify(o)); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "audit/auth-state.json" });

// ---------- CONTACTS: create + DB ----------
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const cname = `Audit Contact ${STAMP}`;
  await page.getByRole("button", { name: /new contact|add contact/i }).first().click();
  await page.waitForTimeout(1000);
  await page.getByLabel("Name", { exact: true }).fill(cname);
  await page.getByLabel("Title").fill("Audit Director").catch(() => {});
  await page.getByLabel("Email").fill(`audit_${STAMP}@example.com`).catch(() => {});
  // Funder select required? choose index 1 if present
  const fsel = page.getByLabel("Funder");
  if (await fsel.count() > 0) { const o = await fsel.locator("option").count(); if (o > 1) await fsel.selectOption({ index: 1 }).catch(()=>{}); }
  await page.getByRole("button", { name: /create contact|save/i }).first().click();
  await page.waitForTimeout(3000);
  const { data } = await admin.from("contacts").select("id,name,title").eq("organization_id", ORG).eq("name", cname);
  rec({ test: "contacts.create", name: cname, dbRows: data?.length || 0, dbRecord: data?.[0] || null, url: page.url() });
  await page.screenshot({ path: `${SHOT}/p3-contact-create.png`, fullPage: true });
  await page.close();
} catch (e) { rec({ test: "contacts.create", error: String(e).slice(0, 250) }); }

// ---------- DOCUMENTS: upload test.txt + storage/DB ----------
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/documents`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const before = (await admin.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", ORG)).count;
  // set file input directly
  const fileInput = page.locator('input[type="file"]').first();
  const fpath = path.resolve("audit/test-upload.txt");
  let uploaded = false;
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(fpath);
    await page.waitForTimeout(4000);
    uploaded = true;
  }
  await page.screenshot({ path: `${SHOT}/p3-documents.png`, fullPage: true });
  const after = (await admin.from("documents").select("id,name,storage_path,file_name", { count: "exact" }).eq("organization_id", ORG).order("created_at", { ascending: false }).limit(3));
  // check storage bucket for the newest path
  let storageOk = null, newestPath = after.data?.[0]?.storage_path || null;
  if (newestPath) {
    const dir = newestPath.split("/").slice(0, -1).join("/");
    const fileN = newestPath.split("/").pop();
    const { data: list } = await admin.storage.from("documents").list(dir).catch(() => ({ data: null }));
    storageOk = Array.isArray(list) ? list.some((f) => f.name === fileN) : null;
  }
  rec({ test: "documents.upload", fileInputFound: await fileInput.count() > 0, uploadAttempted: uploaded, docsBefore: before, docsAfter: after.count, newDoc: after.data?.[0] || null, storageFileExists: storageOk });
  await page.close();
} catch (e) { rec({ test: "documents.upload", error: String(e).slice(0, 250) }); }

// ---------- KNOWLEDGE BASE: tabs + counts ----------
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/knowledge-base`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const tabs = ["Overview", "Org Profile", "Narratives", "Standard Answers"];
  const tabResults = {};
  for (const t of tabs) {
    const link = page.getByRole("link", { name: new RegExp(t, "i") }).first();
    const btn = page.getByRole("button", { name: new RegExp(t, "i") }).first();
    let clicked = false, textLen = 0;
    if (await link.count() > 0) { await link.click().catch(()=>{}); clicked = true; }
    else if (await btn.count() > 0) { await btn.click().catch(()=>{}); clicked = true; }
    await page.waitForTimeout(1200);
    textLen = ((await page.locator("main").innerText().catch(()=>"")) || "").length;
    tabResults[t] = { clicked, url: page.url(), mainTextLen: textLen };
  }
  // proven narrative count
  const { count: pnCount } = await admin.from("proven_narratives").select("*", { count: "exact", head: true }).eq("organization_id", ORG);
  const { count: kbCount } = await admin.from("knowledge_base").select("*", { count: "exact", head: true }).eq("organization_id", ORG);
  rec({ test: "knowledge_base.tabs", tabResults, provenNarrativesDb: pnCount, knowledgeBaseDb: kbCount });
  await page.screenshot({ path: `${SHOT}/p3-kb.png`, fullPage: true });
  await page.close();
} catch (e) { rec({ test: "knowledge_base.tabs", error: String(e).slice(0, 250) }); }

// ---------- DEADLINES: toggles ----------
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/deadlines`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const toggles = {};
  for (const name of ["List", "Calendar", "Show completed", "Completed"]) {
    const el = page.getByRole("button", { name: new RegExp(name, "i") }).first();
    toggles[name] = { found: await el.count() > 0 };
    if (await el.count() > 0) { await el.click().catch(()=>{}); await page.waitForTimeout(800); toggles[name].clickedNoError = true; }
  }
  rec({ test: "deadlines.toggles", toggles, url: page.url() });
  await page.screenshot({ path: `${SHOT}/p3-deadlines-toggle.png`, fullPage: true });
  await page.close();
} catch (e) { rec({ test: "deadlines.toggles", error: String(e).slice(0, 250) }); }

// ---------- APPLICATIONS: kanban drag stage change ----------
try {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/applications`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const cards = page.locator('[draggable="true"]');
  const cardCount = await cards.count();
  // capture a card's app id + current stage from DB by title text on the card
  const columns = page.locator('[data-stage], [data-column], section, div').filter({ hasText: /drafting|submitted|awarded|reporting/i });
  // Attempt native HTML5 drag of first card to a different column via mouse steps
  let dragResult = "not_attempted";
  if (cardCount > 0) {
    const first = cards.first();
    const box = await first.boundingBox();
    // find a drop target column header text different from current
    const targets = page.getByText(/Submitted|In Review|Drafting|Awarded/i);
    const tcount = await targets.count();
    if (box && tcount > 0) {
      const tBox = await targets.nth(Math.min(1, tcount - 1)).boundingBox();
      if (tBox) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + tBox.height / 2, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(2500);
        dragResult = "attempted";
      }
    }
  }
  // Board vs List toggle
  const listToggle = page.getByRole("button", { name: /list/i }).first();
  const boardToggle = page.getByRole("button", { name: /board/i }).first();
  const hasToggle = (await listToggle.count() > 0) || (await boardToggle.count() > 0);
  rec({ test: "applications.kanban", draggableCards: cardCount, dragResult, boardListToggleFound: hasToggle });
  await page.screenshot({ path: `${SHOT}/p3-applications.png`, fullPage: true });
  await page.close();
} catch (e) { rec({ test: "applications.kanban", error: String(e).slice(0, 250) }); }

await browser.close();
writeFileSync("audit/phase3-ui.json", JSON.stringify(out, null, 2));
console.log("\nWrote audit/phase3-ui.json");
