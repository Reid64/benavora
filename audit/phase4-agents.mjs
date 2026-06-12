// PHASE 4 — Exercise every AI/agent endpoint with reid's authenticated session.
// Replays the Supabase auth cookie from auth-state.json. Records HTTP status,
// response excerpt, latency, and the agent_runs delta after each call.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("="); env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ORG = "bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";

const state = JSON.parse(readFileSync("audit/auth-state.json", "utf8"));
const cookieHeader = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

const OPP = "b98c13d4-919c-4e4e-9832-d0ae27731496";      // Brightwater Housing Stability Initiative 2026
const APP = "35f1e058-3edb-4434-889c-098d5cbc4683";      // FAITH application (awarded)
const FUNDER = "9d6071af-8abc-4d1f-9e51-b11456d116df";   // Brightwater Foundation

async function agentRunCount() {
  const { count } = await admin.from("agent_runs").select("*", { count: "exact", head: true }).eq("organization_id", ORG);
  return count ?? 0;
}
async function latestRun() {
  const { data } = await admin.from("agent_runs").select("agent_type,status,duration_ms,tokens_used,error_message,created_at").eq("organization_id", ORG).order("created_at", { ascending: false }).limit(1);
  return data && data[0];
}

const results = [];
async function call(name, path, body, opts = {}) {
  const before = await agentRunCount();
  const t0 = Date.now();
  let status, json, text;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: opts.method || "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: opts.method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    status = res.status;
    text = await res.text();
    try { json = JSON.parse(text); } catch { json = null; }
  } catch (e) { status = "FETCH_ERR"; text = String(e); }
  const ms = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 800));
  const after = await agentRunCount();
  const last = await latestRun();
  const rec = {
    name, path, httpStatus: status, latencyMs: ms,
    agentRunsBefore: before, agentRunsAfter: after, newAgentRun: after > before,
    latestRun: last,
    responseKeys: json ? Object.keys(json) : null,
    responseExcerpt: (text || "").replace(/\s+/g, " ").slice(0, 400),
  };
  results.push(rec);
  console.log(`\n### ${name} -> ${path}  HTTP ${status}  ${ms}ms  newRun=${rec.newAgentRun}`);
  console.log("   keys:", rec.responseKeys);
  console.log("   excerpt:", rec.responseExcerpt.slice(0, 280));
  if (last) console.log("   latest agent_run:", JSON.stringify(last));
  return rec;
}

// 1. Eligibility
await call("eligibility", "/api/agents/eligibility", { opportunityId: OPP });
// 2. Draft (grant_narrative)
await call("draft_grant_narrative", "/api/ai/draft", { opportunityId: OPP, templateType: "grant_narrative" });
// 3. Review (applicationId)
await call("review", "/api/ai/review", { applicationId: APP });
// 4. Summarize
await call("summarize", "/api/ai/summarize", { opportunityId: OPP, rawText: "This NOFA funds rapid re-housing for families experiencing homelessness. Applicants must be 501c3 nonprofits operating supportive housing in the state. Award range $50k-$250k. Deadline June 2026." });
// 5. Fit analysis
await call("fit_analysis", "/api/ai/fit-analysis", { opportunityId: OPP });
// 6. Research (needs profileId+agentType; FAITH has no search profile -> expect failure, document)
await call("research", "/api/agents/research", { profileId: "00000000-0000-0000-0000-000000000000", agentType: "foundation_grants" });
// 7. Learning (needs a FAITH outcome; create one via service role first)
let outcomeId = null;
{
  const { data, error } = await admin.from("outcomes").insert({
    organization_id: ORG, application_id: APP, status: "awarded",
    amount_awarded: 75000, decision_date: "2026-05-01",
  }).select("id").single();
  if (error) console.log("   (could not create FAITH outcome for learning:", error.message, ")");
  else { outcomeId = data.id; console.log("   created FAITH outcome", outcomeId, "for learning test"); }
}
await call("learning", "/api/agents/learning", { outcomeId: outcomeId || "00000000-0000-0000-0000-000000000000" });
// 8. Outreach (needs cold_outreach flag — OFF by default; document gate)
await call("outreach_flagOFF", "/api/agents/outreach", { companyName: "Acme Corp", websiteUrl: "https://acme.example.com", funderId: FUNDER });
// 9. Deadline check
await call("deadline_check_POST", "/api/deadlines/check", {});
await call("deadline_check_GET", "/api/deadlines/check", {}, { method: "GET" });

writeFileSync("audit/phase4-results.json", JSON.stringify(results, null, 2));
console.log("\n\nWrote audit/phase4-results.json");
