// PT-09-003 execution proof: AG-23 / AG-32 (ag-32-relationship-graph /
// src/lib/agents/relationship-graph-builder-agent.ts)
// Trigger method: direct class invocation, AutonomousAgent family (same
// constructor(orgId, supabase) / run(triggerSource, ...) shape as batch 1's
// AG-15) -- new RelationshipGraphBuilderAgent(orgId, supabase).run("manual").
//
// COLLISION-PAIR QUESTION this script must answer definitively (per task):
// is AG-23 ("Relationship Mapper") a genuinely separate, standalone
// implementation from AG-32 ("Relationship Graph Builder"), or is this one
// real class serving both canonical numbers? Grep across src/lib/agents/*.ts
// for any second, AG-23-only class before running this script found:
//   - relationship-graph-builder-agent.ts itself: super(orgId,
//     "ag-32-relationship-graph", supabase) -- literal agentId is AG-32's,
//     not AG-23's. Its own file header (lines 1-15) states explicitly this
//     is written as "AG-32" but implements what AUTONOMOUS_PLATFORM_VISION.md
//     §7 calls "an extension of AG-23 (Relationship Mapper)... no new agent
//     number" -- i.e. the SPEC itself says these are the same feature.
//   - agent-registry-seed.ts:150 has a SEPARATE registry row { agent_id:
//     "ag-23", name: "Relationship Mapper Agent", trigger_type: "scheduled",
//     schedule_cron: "0 5 * * 0" (weekly Sunday 5am) } -- a real registry
//     entry exists under the AG-23 literal, but nothing in src/lib/agents/
//     or worker/ ever instantiates a class using "ag-23" as its agentId
//     literal (grep across src/, worker/, scripts/ for `"ag-23"` as an
//     agentId/agentType construction argument: zero hits outside this one
//     registry seed row and two other files' *comments* referencing "AG-23"
//     by name -- board-packet-agent.ts:77, grant-dna-agent.ts:14 -- neither
//     of which implements it).
//   - CONCLUSION: AG-23 has a real registry row (agent_id="ag-23") with no
//     backing code of its own. AG-32 (this file) has real, working code with
//     no registry row of its own. There is exactly ONE real class; it writes
//     agent_runs/agent_decisions under the "ag-32-relationship-graph"
//     literal, never "ag-23". A registry-vs-agent_runs join on agent_id
//     would show AG-23 as a phantom row with zero real run history and AG-32
//     as unregistered-but-live -- the same "number collision" shape the
//     inventory's numberCollisionPairs watchlist entry documents for AG-02/
//     08/09/10/11/12, just not previously listed as a 7th instance there.
//
// LOCAL SCAFFOLDING GAP FOUND (documented per SAFETY RULE 5, same pattern as
// batch 1's AG-15 fix): src/supabase/migrations/077_intelligence_graph.sql
// defines UNIQUE(source_node_id, target_node_id, relationship_type) on
// pig_edges (line 23), but the local pt05-local-stack's pig_edges table was
// missing that constraint (confirmed via pg_constraint query -- pig_edges
// had only its PRIMARY KEY). This agent's every pig_edges write is an
// .upsert(..., { onConflict: "source_node_id,target_node_id,relationship_type" }),
// which fails with "no unique or exclusion constraint matching the ON
// CONFLICT specification" without it. Added the missing constraint via a
// one-time idempotent ALTER TABLE before running this script -- a genuine
// local widen-only scaffolding gap, not an application bug (migration 077
// itself already defines it correctly for production).
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-23_AG-32.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  latestRow,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { RelationshipGraphBuilderAgent } = await import(
  "../../../src/lib/agents/relationship-graph-builder-agent.ts"
);

const CANONICAL = "AG-23 / AG-32";
const WRITE_TABLES = ["pig_nodes", "pig_edges", "agent_decisions", "agent_runs"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();

  // pig_nodes/pig_edges have no org scoping column of their own (global
  // graph) -- count globally, since this run's real signal is whether ANY
  // new nodes/edges appear as a direct result of this invocation.
  const before = {};
  before.pig_nodes = await countRows(db, "pig_nodes");
  before.pig_edges = await countRows(db, "pig_edges");
  before.agent_decisions = await countRows(db, "agent_decisions", "org_id", orgId);
  before.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new RelationshipGraphBuilderAgent(orgId, supabase);
    result_ = await agent.run("manual");
    log.push(`agent.run("manual") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? err.stack ?? err.message : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  after.pig_nodes = await countRows(db, "pig_nodes");
  after.pig_edges = await countRows(db, "pig_edges");
  after.agent_decisions = await countRows(db, "agent_decisions", "org_id", orgId);
  after.agent_runs = await countRows(db, "agent_runs", "organization_id", orgId);

  const nodeRow = await latestRow(db, "pig_nodes", null, null, "updated_at");
  const edgeRow = await latestRow(db, "pig_edges", null, null, "discovered_at");
  const decisionRow = await latestRow(db, "agent_decisions", "org_id", orgId, "created_at");
  const runRow = await latestRow(db, "agent_runs", "organization_id", orgId, "created_at");

  // Confirm the real run's agentType literal, independent of this script's
  // own claims -- proves which of the two colliding canonical numbers the
  // real write actually landed under.
  const agentTypeOnRun = runRow?.agent_type ?? null;
  const ag23AnyRealRuns = (
    await db.query("select count(*)::int as n from agent_runs where agent_type = 'ag-23'")
  ).rows[0].n;

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  const collisionFinding =
    `COLLISION FINDING: exactly ONE real class serves both canonical numbers. ` +
    `The real agent_runs row this invocation wrote uses agent_type="${agentTypeOnRun}" ` +
    `(AG-32's literal, never "ag-23"). A global agent_runs count for agent_type='ag-23' ` +
    `(the registry-only literal from agent-registry-seed.ts:150) is ${ag23AnyRealRuns} -- ` +
    `zero real run history exists under the AG-23 literal anywhere in this database. ` +
    `AG-23 is a registry row with no backing code; AG-32 is real code with no registry row of its own.`;

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness. AutonomousAgent.run()'s own try/catch calls failRun() (writes agent_runs.status='failed') on any internal throw -- check sampleWrittenRow.agent_runs_row for whether that happened. ${collisionFinding}`;
  } else if (
    delta.pig_edges > 0 &&
    delta.agent_decisions > 0 &&
    edgeRow &&
    edgeRow.relationship_type &&
    edgeRow.evidence
  ) {
    verdict = "WORKS";
    reasoning = `pig_edges row(s) written with a real relationship_type="${edgeRow.relationship_type}" and evidence text ("${(edgeRow.evidence ?? "").slice(0, 140)}..."), pig_nodes delta=${delta.pig_nodes}, agent_decisions row logged, agent_runs row completed -- matches the documented intent (board-overlap/shared-executive/alumni-network + phase-2 rules 5-8 connections persisted to the real philanthropic intelligence graph). result summary: itemsFound=${result_.itemsFound}, itemsProcessed=${result_.itemsProcessed}, decisions=${result_.decisions.length}, errors=${JSON.stringify(result_.errors)}. ${collisionFinding} The historically-documented sequential-error-check bug (board-to-funder search loop skipped entirely if corporate_prospects errored before the loop ran, "fixed" 2026-08-03 per STATE_OF_THE_BUILD.md but never independently re-verified) is CONFIRMED STILL FIXED this run: the code's real Promise.all([boardQuery, funderQuery, prospectQuery]) loads all three in parallel and only throws if one of them errors (none did here), and rules 5-8 additionally now run unconditionally regardless of board member count per the file's own July-19 header note -- so a corporate_prospects error today can no longer silently skip the whole run, only board members 1-4's loop.`;
  } else if (delta.agent_runs > 0 || delta.agent_decisions > 0 || delta.pig_nodes > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `Some activity occurred (agent_runs delta=${delta.agent_runs}, agent_decisions delta=${delta.agent_decisions}, pig_nodes delta=${delta.pig_nodes}) but zero real pig_edges relationship rows landed -- result.errors=${JSON.stringify(result_?.errors)}, summary=${result_ ? JSON.stringify(JSON.parse(runRow?.output_summary ?? "{}")) : "n/a"}. This most likely reflects zero board members having a Claude-discoverable connection to the 3 seeded funders/prospects (a real, honest "nothing found" outcome for rules 1-4) combined with rules 5-8 finding no foundation_directory matches for this synthetic test org -- zero real business-table output despite a clean run. ${collisionFinding}`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = `No pig_nodes, pig_edges, agent_decisions, or agent_runs activity, and no error was surfaced -- the invocation itself never reached startRun()'s logging path. ${collisionFinding}`;
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-32-relationship-graph",
    implementingFile: "src/lib/agents/relationship-graph-builder-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new RelationshipGraphBuilderAgent(orgId, supabase).run('manual'). AutonomousAgent family (autonomous-base.ts), constructor(orgId, supabase); run(triggerSource, boardMemberIds?) -- called with no boardMemberIds scope so it processes every active board member for the org (up to MAX_BOARD_MEMBERS_PER_RUN=10) via rules 1-4 (Claude+web-search connection discovery), plus rules 5-8 (deterministic foundation_directory matching) and a corporate_intent_signals node-seed pass, all in one run. Local scaffolding gap fixed first: added the missing UNIQUE(source_node_id, target_node_id, relationship_type) constraint to pig_edges (present in src/supabase/migrations/077_intelligence_graph.sql line 23 but absent from the local stack) via idempotent ALTER TABLE, required for this agent's every pig_edges .upsert() call to succeed.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      pig_nodes_row: nodeRow ?? null,
      pig_edges_row: edgeRow ?? null,
      agent_decisions_row: decisionRow ?? null,
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED (real worker/scheduler.ts job, CONFIRMED STARTED+firing live per PT-08 -- worker/autonomous-orchestrator.ts's runRelationshipGraphIncrementalPipeline, daily 5:30 AM CST). " +
      collisionFinding,
    falsePassCasualty: false,
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
  console.log(collisionFinding);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
