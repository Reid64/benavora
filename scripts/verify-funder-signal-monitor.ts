// One-off live verification script for AG-43 Funder Signal Monitor
// (FEATURE_REGISTRY_v2.md row #99, migration 137).
//
// Directly instantiates and runs the real agent against a real funder in
// the real Faith Foundation org, via the real service-role admin client -
// no mocks. Exercises both halves: news (real grounded web search via the
// real Anthropic API) and 990 filing (real foundation_directory row,
// matched by name+state, with real ProPublica-sourced financials).
//
// Run with: node --import tsx scripts/verify-funder-signal-monitor.ts

import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { createAdminClient } from "../src/lib/supabase/admin";
import { FunderSignalMonitorAgent } from "../src/lib/agents/funder-signal-monitor-agent";

async function main() {
  const orgId = process.env.FAITH_FOUNDATION_ORG_ID;
  if (!orgId) {
    throw new Error("FAITH_FOUNDATION_ORG_ID not set in .env.local");
  }

  const admin = createAdminClient();

  const { data: funders, error: fundersError } = await admin
    .from("funders")
    .select("id, name, category, geographic_focus")
    .eq("organization_id", orgId)
    .in("category", ["private_foundation", "corporate_foundation"])
    .order("created_at", { ascending: false });
  if (fundersError) throw fundersError;
  console.log(`Funders on file for this org (private/corporate foundation): ${JSON.stringify(funders, null, 2)}`);

  const targetName = process.argv[2];
  const target = targetName
    ? funders?.find((f) => f.name === targetName)
    : funders?.[0];
  if (!target) throw new Error("No matching private_foundation/corporate_foundation funder found for this org.");

  console.log(`\n=== Running FunderSignalMonitorAgent (ag-43-funder-signals) for funder "${target.name}" (${target.id}) ===`);
  const agent = new FunderSignalMonitorAgent(orgId, admin);
  const result = await agent.runForFunder(target.id, "manual");
  console.log("Agent result:", JSON.stringify(result, null, 2));

  console.log("\n=== Re-querying agent_runs directly ===");
  const { data: runs, error: runsError } = await admin
    .from("agent_runs")
    .select("id, agent_type, status, started_at, completed_at, error_message, output_summary, items_found, items_processed, items_queued, tokens_used")
    .eq("agent_type", "ag-43-funder-signals")
    .eq("organization_id", orgId)
    .order("started_at", { ascending: false })
    .limit(3);
  if (runsError) console.error("agent_runs query error:", runsError.message);
  else console.log(JSON.stringify(runs, null, 2));

  console.log("\n=== Re-querying funder_relationship_signals directly ===");
  const { data: signals, error: signalsError } = await admin
    .from("funder_relationship_signals")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (signalsError) console.error("funder_relationship_signals query error:", signalsError.message);
  else console.log(JSON.stringify(signals, null, 2));

  console.log("\n=== Re-querying agent_decisions directly ===");
  const { data: decisions, error: decisionsError } = await admin
    .from("agent_decisions")
    .select("id, decision_type, entity_type, entity_id, confidence_score, action_taken, required_human_review")
    .eq("agent_id", "ag-43-funder-signals")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (decisionsError) console.error("agent_decisions query error:", decisionsError.message);
  else console.log(JSON.stringify(decisions, null, 2));

  console.log("\n=== Re-querying relationship_memory bridge writes ===");
  const { data: memory, error: memoryError } = await admin
    .from("relationship_memory")
    .select("id, entity_id, entity_type, memory_type, content, signal_date")
    .eq("org_id", orgId)
    .in("memory_type", ["news_signal", "990_signal"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (memoryError) console.error("relationship_memory query error:", memoryError.message);
  else console.log(JSON.stringify(memory, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
