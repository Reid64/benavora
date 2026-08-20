// PT-09-003 execution proof: AG-30 (Donor Intent Monitor)
// registryAgentId ag-30-donor-intent / src/lib/agents/donor-intent-monitor-agent.ts
//
// watchListRef check (per task instructions): does this class make a real
// per-signal Claude call, and does it now succeed against the current key
// (it was historically blocked on the same rotated-API-key issue as
// AG-15/AG-22 per STATE_OF_THE_BUILD.md)? Reading the real code: yes -- it
// makes exactly 3 real callClaudeWithWebSearch() calls per prospect (one
// per SEARCH_QUERY_TEMPLATES entry: CSR/giving, ESG, press-release), each
// forced via maxSearches:1. This script reports definitively below whether
// those calls succeed.
//
// Trigger method: direct class invocation, AutonomousAgent family --
// constructor(orgId, supabase); run(triggerSource). "manual" takes the same
// loadProspects()/searchProspect() path the nightly pipeline would exercise
// once past org_autonomous_config.auto_donor_intent_enabled, per
// pt09-001/agent-inventory.json.
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-30.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { DonorIntentMonitorAgent } = await import(
  "../../../src/lib/agents/donor-intent-monitor-agent.ts"
);

const CANONICAL = "AG-30";
const WRITE_TABLES = ["agent_runs", "agent_decisions", "corporate_intent_signals", "alerts", "submission_queue"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-30-donor-intent"),
    agent_decisions: (
      await db.query("select count(*)::int as n from agent_decisions where org_id=$1 and agent_id='ag-30-donor-intent'", [orgId])
    ).rows[0].n,
    corporate_intent_signals: await countRows(db, "corporate_intent_signals", "org_id", orgId),
    alerts: await countRows(db, "alerts", "organization_id", orgId),
    submission_queue: await countRows(db, "submission_queue", "organization_id", orgId),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new DonorIntentMonitorAgent(orgId, supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-30-donor-intent"),
    agent_decisions: (
      await db.query("select count(*)::int as n from agent_decisions where org_id=$1 and agent_id='ag-30-donor-intent'", [orgId])
    ).rows[0].n,
    corporate_intent_signals: await countRows(db, "corporate_intent_signals", "org_id", orgId),
    alerts: await countRows(db, "alerts", "organization_id", orgId),
    submission_queue: await countRows(db, "submission_queue", "organization_id", orgId),
  };

  const runRow = (
    await db.query(
      "select * from agent_runs where agent_type='ag-30-donor-intent' and organization_id=$1 order by created_at desc limit 1",
      [orgId],
    )
  ).rows[0] ?? null;
  const signalRows = (
    await db.query("select * from corporate_intent_signals where org_id=$1 order by created_at desc limit 5", [orgId])
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  // Distinguish "ran clean, real web search issued, but nothing crossed the
  // intent threshold" (WIRED-NO-OUTPUT, real finding about these synthetic
  // test prospects) from a genuine Claude/web-search failure.
  const outputSummary = runRow?.output_summary ?? "";
  const webSearchLikelyIssued = !errorSurfaced && result_?.success === true;

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}. Check sampleWrittenRow.agent_runs_row for a status='failed' row -- present means failRun() surfaced it, absent means the throw happened before startRun() completed. This would indicate the historical rotated-API-key block (watchListRef wasBlockedOnRotatedApiKey) may have reproduced, or a different real failure.`;
  } else if (delta.corporate_intent_signals > 0 && signalRows[0]?.signal_summary) {
    verdict = "WORKS";
    reasoning = `corporate_intent_signals row(s) written with real, Claude-web-search-derived content: signal_type=${signalRows[0].signal_type}, intent_score=${signalRows[0].intent_score}, summary="${signalRows[0].signal_summary}". This confirms the 3-per-prospect callClaudeWithWebSearch() calls (CSR/ESG/press-release queries) succeeded for real against the current ANTHROPIC_API_KEY -- the historical rotated-key block (watchListRef wasBlockedOnRotatedApiKey, same failure mode as AG-15/AG-22) is NOT reproduced here; the key works. itemsFound=${result_.itemsFound}, itemsProcessed=${result_.itemsProcessed}, itemsQueued=${result_.itemsQueued}.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly (itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}, outputSummary="${outputSummary}") but zero corporate_intent_signals rows landed. Per the real code, this most likely means the 3 real web searches per prospect (against synthetic test company names "Hill Country Logistics LLC" / "Lonestar Manufacturing Co", which have no real CSR/ESG/press-release footprint to find) genuinely found no real, citable signal above the INTENT_SCORE_THRESHOLD=60 gate -- a real, grounded null result on synthetic data, not a broken trigger. Check errorSurfaced/result_.errors for whether any individual search call itself failed (distinct from a search that succeeded but found nothing) -- see triggerLog for the full per-call error list this agent's own searchProspect() collects.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs, agent_decisions, or corporate_intent_signals activity, and no error was surfaced -- the invocation never reached startRun()'s logging path.";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-30-donor-intent",
    implementingFile: "src/lib/agents/donor-intent-monitor-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new DonorIntentMonitorAgent(orgId, supabase).run('manual'). AutonomousAgent family, per-org. Scope: corporate_prospects (shared, non-org-scoped pool per project memory benavora-corporate-prospects-no-org-id) -- environment.json's 2 seeded prospects (Hill Country Logistics LLC, Lonestar Manufacturing Co) were used; both have address_city/address_state=NULL locally so geographicRelevanceFactor() falls back to the 0.2 national floor rather than a same-state/adjacent-state match, which only affects the computed intent_score, not whether the agent runs or searches.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      corporate_intent_signals_rows: signalRows,
      agent_runs_row: runRow,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED-NIGHTLY+QUEUE (registry metadata stale: claims manual, is actually scheduled). watchListRef: historically blocked on the same rotated-API-key issue as AG-15/AG-22 if it makes real per-signal Claude calls -- it does (3 real callClaudeWithWebSearch calls per prospect); this run tests whether that's still true against the current key.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
