// PT-09-002 execution proof: AG-18 (ag-18-reputation /
// src/lib/intelligence/reputation-agent.ts)
//
// The task brief describes AG-18 as "NOT a class -- the exported async
// function checkEntityReputation()". Reading the real file in full (as
// instructed) found that is only half true: the same file ALSO contains a
// real AutonomousAgent subclass, ReputationIntelligenceAgent (constructor
// super(orgId, "ag-18-reputation", supabase)), added after whatever prior
// pass produced that description. worker/autonomous-orchestrator.ts (real
// nightly wiring, checked directly) confirms BOTH are genuinely live: bare
// entities go through checkEntityReputation() directly; funders specifically
// route through ReputationIntelligenceAgent.runForFunder() (orchestrator
// lines ~1852-1871), which itself calls checkEntityReputation() internally
// and then fans results out into reputation_alerts + agent_decisions +
// (HIGH/CRITICAL) relationship_memory + a critical alert.
//
// This script exercises the fuller, class-based path (runForFunder) since
// it is the real production route for the entity type the task suggested
// ("one of the seeded funders' names") and is a strict superset of
// checkEntityReputation() -- proving it also proves the plain function.
// checkEntityReputation() itself is documented and available at
// src/lib/intelligence/reputation-agent.ts:232 if narrower testing is
// wanted later.
//
// Seeded funder names are synthetic ("PT-09 Community Foundation", etc.) and
// would return zero real DuckDuckGo Instant-Answer results, which would only
// prove "the write path never fires" rather than "the write path works" --
// the actual thing under test. To generate genuine, real signal, this run
// passes a well-known real-world entity NAME ("Wells Fargo", a bank with a
// large real public record of lawsuits/regulatory actions -- exactly what
// SEARCH_SUFFIX = "lawsuit fraud scandal leadership change" is built to
// surface) while keeping entity_id/entity_type scoped to one of our seeded
// funder rows (reputation_signals carries no organization_id -- it is
// explicitly platform-shared/entity-scoped by design, see the file's own
// header -- so this does not cross any tenant boundary). This substitution
// is called out here and in triggerLog/verdictReasoning, not hidden.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-18.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { ReputationIntelligenceAgent } = await import(
  "../../../src/lib/intelligence/reputation-agent.ts"
);

const CANONICAL = "AG-18";
const WRITE_TABLES = ["reputation_signals", "reputation_alerts", "agent_runs", "agent_decisions"];
const RUN_TIMEOUT_MS = 110_000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`HARNESS TIMEOUT after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  const funder = env.funders[0]; // PT-09 Community Foundation (id used as entity_id)
  const REAL_ENTITY_NAME = "Wells Fargo";

  const db = await pgClient();

  const before = {};
  before.reputation_signals = await countRows(db, "reputation_signals", "entity_id", funder.id);
  before.reputation_alerts = await countRows(db, "reputation_alerts", "org_id", orgId);
  before.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);
  before.agent_decisions = await countRows(db, "agent_decisions", "org_id", orgId);
  before.relationship_memory = await countRows(db, "relationship_memory", "org_id", orgId);
  before.alerts = await countRows(db, "alerts", "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();

  const log = [];
  log.push(`Target funder row: ${funder.id} (seeded name "${funder.name}"). Search entity name substituted to real-world "${REAL_ENTITY_NAME}" to generate genuine DuckDuckGo signal -- see file header.`);

  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new ReputationIntelligenceAgent(orgId, supabase);
    runOutcome = await withTimeout(
      agent.runForFunder(funder.id, REAL_ENTITY_NAME, "manual"),
      RUN_TIMEOUT_MS,
      "ReputationIntelligenceAgent.runForFunder()",
    );
    log.push(`agent.runForFunder() resolved: ${JSON.stringify(runOutcome)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  after.reputation_signals = await countRows(db, "reputation_signals", "entity_id", funder.id);
  after.reputation_alerts = await countRows(db, "reputation_alerts", "org_id", orgId);
  after.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);
  after.agent_decisions = await countRows(db, "agent_decisions", "org_id", orgId);
  after.relationship_memory = await countRows(db, "relationship_memory", "org_id", orgId);
  after.alerts = await countRows(db, "alerts", "organization_id", orgId);

  const newSignal = (
    await db.query("select * from reputation_signals where entity_id = $1 order by created_at desc limit 1", [funder.id])
  ).rows[0];
  const newAlert = (
    await db.query("select * from reputation_alerts where org_id = $1 order by created_at desc limit 1", [orgId])
  ).rows[0];
  const newDecision = (
    await db.query("select * from agent_decisions where org_id = $1 and agent_id = 'ag-18-reputation' order by created_at desc limit 1", [orgId])
  ).rows[0];
  const runRow = (
    await db.query("select * from agent_runs where organization_id = $1 and agent_type = 'ag-18-reputation' order by created_at desc limit 1", [orgId])
  ).rows[0];

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.runForFunder() threw (or the harness timeout fired); caught by this harness (not silently swallowed by the app), but no successful run completed.";
  } else if (delta.agent_runs > 0 && delta.reputation_signals > 0 && newSignal) {
    verdict = "WORKS";
    reasoning =
      `A real agent_runs row was written, and a genuine reputation_signals row was inserted from a real DuckDuckGo Instant-Answer search + Claude classification pass against a real-world entity with real news signal -- matches AG-18's documented intent. ` +
      `delta.reputation_alerts=${delta.reputation_alerts} (org-scoped fan-out via reputation_alerts, migration 076), delta.agent_decisions=${delta.agent_decisions} (audit trail per signal), delta.relationship_memory=${delta.relationship_memory} (only written for HIGH/CRITICAL severity, per code) -- this run's real severity classification determined which of those fired; see sampleWrittenRow for the actual classified severity.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning =
      `agent_runs completed cleanly (output: ${runOutcome ? JSON.stringify(runOutcome) : "n/a"}) but zero reputation_signals rows were written. Given the real-world entity name chosen specifically to surface signal, this is a more notable "ran clean, wrote nothing" result than a synthetic-name test would be -- either DuckDuckGo's free Instant-Answer API returned no RelatedTopics for this query today (a known limitation: it is not a general web search, only its own curated instant-answer index) or Claude classified every returned result as neither risk nor positive. See triggerLog/sampleWrittenRow for exactly which.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor reputation_signals changed, and no error was surfaced -- the invocation never reached AutonomousAgent.startRun()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-18-reputation",
    implementingFile: "src/lib/intelligence/reputation-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new ReputationIntelligenceAgent(orgId, supabase).runForFunder(funderId, entityName, 'manual'). This class was found in the same file as the plain checkEntityReputation() function the task brief named, and worker/autonomous-orchestrator.ts (lines ~1852-1871, checked directly) confirms it is the real production route for funder-specific reputation checks (checkEntityReputation() itself handles the bare-entity/non-funder case). runForFunder() calls checkEntityReputation() internally (real DuckDuckGo Instant-Answer API call + real Claude classification call per result, no mocking) then fans out into reputation_alerts/agent_decisions/(conditionally)relationship_memory/alerts exactly as the nightly whole-org run() does, scoped to one funder. Entity NAME substituted to the real-world 'Wells Fargo' (see file header) while entity_id stayed a real seeded funder row -- reputation_signals carries no organization_id by design (platform-shared entity data), so this does not cross any tenant boundary.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      reputation_signals_row: newSignal ?? null,
      reputation_alerts_row: newAlert ?? null,
      agent_decisions_row: newDecision ?? null,
      agent_runs_row: runRow ?? null,
      run_outcome: runOutcome ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED-GATED (scheduled: runReputationStep() inside runOrgPipeline() -> nightly 2 AM pipeline, gated on auto_reputation_enabled). FEATURE_REGISTRY_v2.md row #199 ('AG-18 Autonomous Reputation Intelligence'): status BUILT -- \"Severity classification. Instant CRITICAL alerts. Correction, July 30 2026: 'Auto memory entries' does not describe the live path. That behavior (writing relationship_memory rows for HIGH/CRITICAL signals) exists only in a separate, undocumented ReputationIntelligenceAgent class ... that is never imported or instantiated anywhere outside its own file -- the actual nightly path (runReputationStep()) calls the plain checkEntityReputation() function directly and writes only reputation_signals + reputation_alerts + a critical-severity alerts row, with no relationship_memory write.\" NOTE: that row's own claim ('never imported or instantiated anywhere outside its own file') is now stale/superseded by this session's own direct read of autonomous-orchestrator.ts, which DOES instantiate and call ReputationIntelligenceAgent for funders (lines ~1852-1871) -- worth re-flagging as a registry-vs-code drift distinct from this agent's WORKS/WIRED-NO-OUTPUT verdict above.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
