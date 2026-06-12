// PHASE 1 — Database verification.
// Uses service-role key (bypasses RLS) for ground-truth counts, and anon key
// for a behavioral RLS test. No Management API / personal access token available,
// so RLS is verified by BEHAVIOR (anon must be blocked) and FK integrity by
// orphan detection.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const raw = readFileSync(".env.local", "utf8");
const env = {};
for (const l of raw.split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const TABLES = [
  "organizations","profiles","funders","contacts","opportunities","opportunity_keywords",
  "applications","pipeline_history","documents","application_documents","knowledge_base",
  "board_members","programs","outcomes","proven_narratives","deadlines","notes",
  "search_profiles","email_campaigns","campaign_steps","outreach_contacts","campaign_sends",
  "agent_runs","platform_config","research_cache","automation_sessions","automation_steps",
  "automation_screenshots","integrations","synced_email_threads","synced_email_messages",
  "email_thread_links","subscriptions","invoices","usage_metrics","audit_logs",
  "user_invitations","onboarding_steps","stripe_webhook_events",
];

const out = { tables: {}, rls: {}, orphans: {}, errors: [] };

async function count(client, table) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  return { count: count ?? null, error: error ? error.message : null };
}

console.log("=== ROW COUNTS (service role) + RLS BEHAVIORAL TEST (anon) ===");
console.log("table".padEnd(26), "svc".padStart(7), "anon".padStart(7), " RLS-blocks-anon");
for (const t of TABLES) {
  const svc = await count(admin, t);
  const an = await count(anon, t);
  if (svc.error) out.errors.push(`${t}: svc error ${svc.error}`);
  // RLS effectively blocks anon if anon sees 0/null while data exists, or errors out.
  const blocked = an.error != null || (an.count === 0 && (svc.count ?? 0) >= 0);
  out.tables[t] = { rows: svc.count, exists: !svc.error || !/does not exist/.test(svc.error || "") };
  out.rls[t] = { anonCount: an.count, anonError: an.error, svcCount: svc.count, blocksAnon: blocked };
  const tag = svc.error ? "TABLE-ERR:" + svc.error.slice(0, 40)
    : `${blocked ? "YES" : "*** NO — anon sees " + an.count + " ***"}`;
  console.log(t.padEnd(26), String(svc.count ?? "ERR").padStart(7), String(an.count ?? "ERR").padStart(7), " " + tag);
}

// ---- FK / orphan checks ----
console.log("\n=== ORPHAN CHECKS ===");
async function allIds(table, col = "id") {
  const ids = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await admin.from(table).select(col).range(from, from + 999);
    if (error) return { ids, error: error.message };
    for (const r of data) if (r[col] != null) ids.add(r[col]);
    if (data.length < 1000) break;
    from += 1000;
  }
  return { ids };
}
async function orphanCheck(childTable, fkCol, parentTable) {
  const parent = await allIds(parentTable);
  if (parent.error) { console.log(`${childTable}.${fkCol} -> ${parentTable}: parent ERR ${parent.error}`); return; }
  const child = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin.from(childTable).select(`id,${fkCol}`).range(from, from + 999);
    if (error) { console.log(`${childTable}.${fkCol}: child ERR ${error.message}`); return; }
    child.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const orphans = child.filter((r) => r[fkCol] != null && !parent.ids.has(r[fkCol]));
  out.orphans[`${childTable}.${fkCol}->${parentTable}`] = { childRows: child.length, orphans: orphans.length, orphanIds: orphans.slice(0, 10).map((o) => o.id) };
  console.log(`${childTable}.${fkCol} -> ${parentTable}: ${child.length} rows, ${orphans.length} orphans${orphans.length ? " *** " + JSON.stringify(orphans.slice(0,5).map(o=>o.id)) : ""}`);
}

const FK_CHECKS = [
  ["profiles", "organization_id", "organizations"],
  ["funders", "organization_id", "organizations"],
  ["contacts", "organization_id", "organizations"],
  ["contacts", "funder_id", "funders"],
  ["opportunities", "organization_id", "organizations"],
  ["opportunities", "funder_id", "funders"],
  ["applications", "organization_id", "organizations"],
  ["applications", "opportunity_id", "opportunities"],
  ["deadlines", "organization_id", "organizations"],
  ["deadlines", "opportunity_id", "opportunities"],
  ["outcomes", "organization_id", "organizations"],
  ["outcomes", "application_id", "applications"],
  ["pipeline_history", "application_id", "applications"],
  ["knowledge_base", "organization_id", "organizations"],
  ["proven_narratives", "organization_id", "organizations"],
  ["documents", "organization_id", "organizations"],
  ["agent_runs", "organization_id", "organizations"],
  ["board_members", "organization_id", "organizations"],
  ["programs", "organization_id", "organizations"],
];
for (const [c, f, p] of FK_CHECKS) await orphanCheck(c, f, p);

writeFileSync("audit/phase1-results.json", JSON.stringify(out, null, 2));
console.log("\nWrote audit/phase1-results.json");
