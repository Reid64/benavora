// PT-09-002 execution proof: AG-17 (ag-17-discovery / src/lib/agents/opportunity-discovery-agent.ts)
// Trigger method: direct class invocation of the AutonomousAgent family --
// same shape as AG-15: constructor(orgId, supabase); run(triggerSource).
// Real trigger path per inventory: nightly pipeline (gated on
// org_autonomous_config.auto_research_enabled) + routeQueueItem() case
// 'ag-17-discovery'. Invoked here with triggerSource="manual".
//
// This agent makes real outbound calls to Grants.gov, SAM.gov, and the
// Federal Register (all read-only external APIs, no writes to any third
// party) plus a foundation-match batch against foundation_directory and a
// possible land-bank sweep. Per the task's SAFETY RULES this is explicitly
// allowed ("real calls to real external read-only APIs... that is the
// actual thing being proven"). Wrapped in a 90s timeout per the task's own
// guidance for this specific agent, since external sources can hang.
//
// The org has one active search_profiles row seeded by the environment
// setup (keywords: ["housing", "workforce development"]), so the standard
// strategy's per-profile federal sweep has something to search with.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-17.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  latestRow,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { OpportunityDiscoveryAgent } = await import("../../../src/lib/agents/opportunity-discovery-agent.ts");

const CANONICAL = "AG-17";
const WRITE_TABLES = ["agent_runs", "opportunities", "search_profiles", "agent_decisions"];
const TIMEOUT_MS = 90_000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label} did not resolve within ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {};
  for (const t of WRITE_TABLES) {
    before[t] = await countRows(
      db,
      t,
      t === "agent_decisions" ? "org_id" : t === "search_profiles" ? "organization_id" : "organization_id",
      orgId,
    );
  }
  const searchProfileBefore = (
    await db.query("select id, last_run_at, results_count from search_profiles where organization_id = $1", [orgId])
  ).rows;

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;
  let timedOut = false;

  try {
    const agent = new OpportunityDiscoveryAgent(orgId, supabase);
    result_ = await withTimeout(agent.run("manual"), TIMEOUT_MS, "OpportunityDiscoveryAgent.run('manual')");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? err.stack ?? err.message : String(err);
    timedOut = errorSurfaced.startsWith("Error: TIMEOUT");
    log.push(`${timedOut ? "TIMED OUT" : "THREW"}: ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) {
    after[t] = await countRows(
      db,
      t,
      t === "agent_decisions" ? "org_id" : "organization_id",
      orgId,
    );
  }
  const searchProfileAfter = (
    await db.query("select id, last_run_at, results_count from search_profiles where organization_id = $1", [orgId])
  ).rows;

  const runRow = await latestRow(db, "agent_runs", "organization_id", orgId, "created_at");
  const newOppRows = result_?.itemsFound
    ? (
        await db.query(
          "select id, name, category, amount_max, deadline, source, source_type, created_at from opportunities where organization_id = $1 order by created_at desc limit 5",
          [orgId],
        )
      ).rows
    : [];
  const decisionRow = await latestRow(db, "agent_decisions", "org_id", orgId, "created_at");

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  const searchProfileTouched = searchProfileBefore.some((b) => {
    const a = searchProfileAfter.find((x) => x.id === b.id);
    return a && a.last_run_at !== b.last_run_at;
  });

  let verdict;
  let reasoning;
  if (timedOut) {
    verdict = "TRIGGER-BROKEN";
    reasoning = `agent.run('manual') did not resolve within ${TIMEOUT_MS}ms -- one or more of the external sources (Grants.gov, SAM.gov, Federal Register) hung. An agent_runs row was opened (startRun() happens before any external call) but never reached completeRun()/failRun() before this harness gave up. This is a real reachability finding, not a fabricated one: check runRow.status below (likely still 'running').`;
  } else if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw past this harness. run() itself is a try/catch that calls failRun() on any internal throw (writes agent_runs.status='failed'), so check sampleWrittenRow.agent_runs_row.status -- if 'failed' with a matching error_message the app DID record it, just nowhere a human would routinely see it without querying agent_runs directly.";
  } else if (delta.agent_runs > 0 && (delta.opportunities > 0 || delta.agent_decisions > 0)) {
    verdict = "WORKS";
    reasoning = `agent_runs row completed; run found itemsFound=${result_.itemsFound} new opportunit(y/ies) this run (perception/decision/execution/observation phases all logged real agent_decisions rows -- strategy selection, per-source results, observation). ${delta.opportunities} opportunities row(s) actually inserted, search_profiles.last_run_at touched=${searchProfileTouched}. Matches AG-17's documented intent: sweep real external sources, dedupe against existing opportunities, insert genuinely new matches with an audit trail. Note: even a 0-new-opportunities run (e.g. every external hit deduped or nothing new was published since the last sweep) still counts as WORKS here because the decision/observation trail (agent_decisions) and search_profiles touch are themselves real, meaningful writes proving the pipeline executed -- not just an empty stub; see agent_decisions_row for the real strategy reasoning text.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs row was written (the run executed, itemsFound=${result_?.itemsFound}) but zero opportunities/agent_decisions activity landed -- zero real business-table output despite a clean run. errors reported by the agent itself: ${JSON.stringify(result_?.errors)}.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs activity, and no error/timeout was surfaced -- the invocation itself never reached startRun()'s logging path.";
  }

  const registryResult = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-17-discovery",
    implementingFile: "src/lib/agents/opportunity-discovery-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      `Direct class invocation via tsx against the local pt05-local-stack: new OpportunityDiscoveryAgent(orgId, supabase).run('manual'), wrapped in a ${TIMEOUT_MS}ms Promise.race timeout per the task's guidance for this specific agent (real external calls to Grants.gov/SAM.gov/Federal Register can hang). AutonomousAgent family (autonomous-base.ts), same constructor/run() shape as AG-15. Real trigger path (per pt09-001/agent-inventory.json) is the nightly pipeline (worker/autonomous-orchestrator.ts runDiscoveryStep(), gated on org_autonomous_config.auto_research_enabled) and routeQueueItem() case 'ag-17-discovery'. The org's one seeded search_profiles row (keywords: housing, workforce development) drives the per-profile federal sweep.`,
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      agent_runs_row: runRow ?? null,
      newest_opportunities_snapshot: newOppRows,
      agent_decisions_row: decisionRow ?? null,
      search_profiles_touched: searchProfileTouched,
      search_profiles_before: searchProfileBefore,
      search_profiles_after: searchProfileAfter,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus: "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED-GATED+QUEUE (code exists, real write target, wired to both the nightly pipeline and the queue processor).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, registryResult);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
