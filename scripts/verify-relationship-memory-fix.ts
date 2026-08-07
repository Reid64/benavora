// One-off live verification script for the relationship_memory /
// relationship_recommendations / reputation_signals / reputation_alerts
// table gap (FEATURE_REGISTRY_v2.md row #98, 2026-08-07 reconciliation).
//
// Directly instantiates and runs the two real, already-built consumer
// agents against the real Faith Foundation org, via the real service-role
// admin client — no mocks, no hand-written INSERTs. Confirms the
// "Could not find the table ... in the schema cache" (42P01/PGRST205)
// failure documented in AGENT_VERIFICATION_LOG.md's AG-18/AG-19 entries no
// longer occurs now that migration 127 has been applied.
//
// Run with: node --import tsx scripts/verify-relationship-memory-fix.ts

import { config } from "dotenv";
config({ path: ".env.local" });
import { createAdminClient } from "../src/lib/supabase/admin";
import { RelationshipBuilderAgent } from "../src/lib/agents/relationship-builder-agent";
import { ReputationIntelligenceAgent } from "../src/lib/intelligence/reputation-agent";

async function main() {
  const orgId = process.env.FAITH_FOUNDATION_ORG_ID;
  if (!orgId) {
    throw new Error("FAITH_FOUNDATION_ORG_ID not set in .env.local");
  }

  const admin = createAdminClient();

  console.log(`\n=== Running ReputationIntelligenceAgent (ag-18-reputation) against org ${orgId} ===`);
  const reputationAgent = new ReputationIntelligenceAgent(orgId, admin);
  const reputationResult = await reputationAgent.run("manual");
  console.log("ReputationIntelligenceAgent result:", JSON.stringify(reputationResult, null, 2));

  console.log(`\n=== Running RelationshipBuilderAgent (ag-19-relationship) against org ${orgId} ===`);
  const relationshipAgent = new RelationshipBuilderAgent(orgId, admin);
  const relationshipResult = await relationshipAgent.run("manual");
  console.log("RelationshipBuilderAgent result:", JSON.stringify(relationshipResult, null, 2));

  // Independently re-query the tables directly, rather than trusting the
  // in-process return values, matching this log's established discipline.
  console.log("\n=== Re-querying agent_runs for both agent_type literals ===");
  const { data: runs, error: runsError } = await admin
    .from("agent_runs")
    .select("id, agent_type, status, started_at, completed_at, error_message, output_summary")
    .in("agent_type", ["ag-18-reputation", "ag-19-relationship"])
    .eq("organization_id", orgId)
    .order("started_at", { ascending: false })
    .limit(4);
  if (runsError) console.error("agent_runs query error:", runsError.message);
  else console.log(JSON.stringify(runs, null, 2));

  console.log("\n=== Row counts in the 4 target tables for this org ===");
  for (const table of [
    "relationship_memory",
    "relationship_recommendations",
    "reputation_alerts",
  ]) {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);
    if (error) console.error(`${table} count error:`, error.message);
    else console.log(`${table}: ${count} row(s) for this org`);
  }
  const { count: signalCount, error: signalErr } = await admin
    .from("reputation_signals")
    .select("id", { count: "exact", head: true });
  if (signalErr) console.error("reputation_signals count error:", signalErr.message);
  else console.log(`reputation_signals: ${signalCount} row(s) total (no org column)`);

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
