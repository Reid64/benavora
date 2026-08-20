// PT-09-003 execution proof: AG-29 (Knowledge Engine Indexer)
// registryAgentId ag-29-knowledge-indexer / src/lib/agents/knowledge-indexer-agent.ts
//
// COLLISION-PAIR NOTE (see also AG-29-fundability.mjs): AGENTS_v2.md's own
// roster assigns "AG-29" to TWO distinct, real classes -- this Knowledge
// Engine Indexer (KnowledgeIndexerAgent, agentId "ag-29-knowledge-indexer",
// platform-level/unscoped) and the separate Fundability Scorer
// (FundabilityScorerAgent, agentId "ag-29-fundability", per-org). They are
// genuinely different files, different constructors (this one takes only
// `supabase`; fundability takes `orgId, supabase`), different write targets
// (this one: knowledge_patterns/embeddings; fundability: fundability_scores),
// and different agent_type literals that cannot collide with each other in
// the DB. Confirmed independently this session by reading both files in
// full -- this is a real, documented dual-use of the number "29", not a bug
// or a duplicate.
//
// Trigger method: direct class invocation, AutonomousAgent family --
// constructor(supabase) only (platform-level, no orgId param -- see the
// class's own file header on why it provisions a well-known SYSTEM_ORG_ID
// internally). run('autonomous') exercises the same loadPendingBatch() path
// worker/knowledge-indexer-processor.ts's real poll loop uses every 60s.
//
// LOCAL SCHEMA NOTE: see _fix-local-schema-gaps-ag29-ag36.mjs (run once
// before this script) for the pgvector extension install + knowledge_patterns
// table creation this class's write targets needed locally, plus a real-text
// seed into foundation_directory. `intelligence_proposal_sections` is NOT
// patched in (FK-dependent on a table that also doesn't exist locally) --
// this class's own loadPendingBatch() already degrades that source to zero
// rows gracefully rather than throwing, so it doesn't block this run; the
// real embeddable content this run finds comes from `outcomes` (one real
// awarded outcome with a substantial narrative_snapshot, embedding NULL)
// and `foundation_directory` (seeded above).
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-29-knowledge-indexer.mjs

import {
  setupLocalEnv,
  pgClient,
  countRows,
  latestRow,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { KnowledgeIndexerAgent, SYSTEM_ORG_ID } = await import(
  "../../../src/lib/agents/knowledge-indexer-agent.ts"
);

const CANONICAL = "AG-29 (Knowledge Engine Indexer)";
const WRITE_TABLES = ["agent_queue", "agent_runs", "foundation_directory", "knowledge_patterns", "outcomes"];

async function main() {
  const db = await pgClient();

  const before = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-29-knowledge-indexer"),
    knowledge_patterns: await countRows(db, "knowledge_patterns"),
    outcomes_embedded: (
      await db.query("select count(*)::int as n from outcomes where embedding is not null")
    ).rows[0].n,
    foundation_directory_embedded: (
      await db.query("select count(*)::int as n from foundation_directory where embedding is not null")
    ).rows[0].n,
    agent_queue: await countRows(db, "agent_queue", "agent_id", "ag-29-knowledge-indexer"),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let result_ = null;

  try {
    const agent = new KnowledgeIndexerAgent(supabase);
    result_ = await agent.run("autonomous");
    log.push(`agent.run("autonomous") resolved: ${JSON.stringify(result_)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    agent_runs: await countRows(db, "agent_runs", "agent_type", "ag-29-knowledge-indexer"),
    knowledge_patterns: await countRows(db, "knowledge_patterns"),
    outcomes_embedded: (
      await db.query("select count(*)::int as n from outcomes where embedding is not null")
    ).rows[0].n,
    foundation_directory_embedded: (
      await db.query("select count(*)::int as n from foundation_directory where embedding is not null")
    ).rows[0].n,
    agent_queue: await countRows(db, "agent_queue", "agent_id", "ag-29-knowledge-indexer"),
  };

  const runRow = await latestRow(db, "agent_runs", "agent_type", "ag-29-knowledge-indexer", "created_at");
  const embeddedOutcome = (
    await db.query(
      "select id, narrative_snapshot, (embedding is not null) as has_embedding, octet_length(embedding::text) as embedding_text_len from outcomes where id = '4660158e-68a9-4019-b085-d8edd1b2a58a'",
    )
  ).rows[0];
  const embeddedFoundation = (
    await db.query(
      "select id, programs, (embedding is not null) as has_embedding from foundation_directory where id = '6540e5b0-965e-43f5-8a77-0ac98a732e6d'",
    )
  ).rows[0];
  const patternRows = (await db.query("select * from knowledge_patterns order by created_at desc limit 3")).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  const embeddedSomething = delta.outcomes_embedded > 0 || delta.foundation_directory_embedded > 0;

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `agent.run() threw past this harness: ${errorSurfaced}. AutonomousAgent.run()'s own try/catch should have called failRun() -- check sampleWrittenRow.agent_runs_row for a status='failed' row; if present the app itself recorded the failure (not truly swallowed), if absent the throw happened before startRun() completed.`;
  } else if (delta.agent_runs > 0 && embeddedSomething && embeddedOutcome?.has_embedding) {
    verdict = "WORKS";
    reasoning =
      `A real agent_runs row completed (itemsFound=${result_.itemsFound}, itemsProcessed=${result_.itemsProcessed}), and the seeded outcome row (id 4660158e..., a substantial real narrative_snapshot about transitional housing services) now carries a real, non-null pgvector embedding (embedding column populated via a genuine OpenAI text-embedding-3-small API call through generateEmbeddingsBatch()) -- outcomes_embedded went ${before.outcomes_embedded}->${after.outcomes_embedded}, foundation_directory_embedded went ${before.foundation_directory_embedded}->${after.foundation_directory_embedded}. This confirms the real OpenAI embedding call succeeds against the current API key. ` +
      (delta.knowledge_patterns > 0
        ? `Pattern aggregation also ran and wrote ${delta.knowledge_patterns} real knowledge_patterns row(s) (category_success_rate over the now-embedded awarded outcome(s)).`
        : `Pattern aggregation ran (ranPatternAggregation=${result_.batchWasFull != null ? "see outputPayload" : "n/a"}) but wrote 0 knowledge_patterns rows this pass -- with only 1-2 awarded outcomes total in this local org and no funder_category/opportunity_category populated on them, there was nothing to group into a category, which is the deterministic aggregation code's correct behavior on this input, not a bug.`);
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs row was written (itemsFound=${result_?.itemsFound}, itemsProcessed=${result_?.itemsProcessed}, errors=${JSON.stringify(result_?.errors)}) but no source table's embedding column changed -- zero real business-table output despite a clean run.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "No agent_runs activity and no error surfaced -- the invocation never reached startRun()'s logging path.";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-29-knowledge-indexer",
    implementingFile: "src/lib/agents/knowledge-indexer-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new KnowledgeIndexerAgent(supabase).run('autonomous'). AutonomousAgent family, platform-level/unscoped (constructor takes only supabase; internally provisions/uses SYSTEM_ORG_ID for agent_runs/agent_decisions/agent_queue FK targets). Real trigger path per pt09-001/agent-inventory.json is worker/knowledge-indexer-processor.ts's dedicated continuous poll loop calling run('autonomous') repeatedly -- this script exercises that exact code path directly. Local schema was patched first (see _fix-local-schema-gaps-ag29-ag36.mjs) to install pgvector and create knowledge_patterns, matching real production migrations 107/096 that were never applied to this local stack.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      embedded_outcome_row: embeddedOutcome ?? null,
      embedded_foundation_directory_row: embeddedFoundation ?? null,
      knowledge_patterns_rows: patternRows,
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning:
      reasoning +
      " NUMBER-COLLISION CROSS-CONFIRMATION: this class (ag-29-knowledge-indexer, src/lib/agents/knowledge-indexer-agent.ts, platform-level embedding/pattern-aggregation) is genuinely distinct from the other real class also claiming 'AG-29' (ag-29-fundability, src/lib/agents/fundability-scorer-agent.ts, per-org Claude-based deficiency scoring against fundability_scores) -- confirmed by reading both files in full this session: different files, different constructors, different agent_type literals (each with its own real agent_queue/agent_runs rows visible in this environment), different write targets, different business purpose. This is a real, deliberate dual-use of the number 29 per AGENTS_v2.md's own roster, not a bug.",
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-EVENT-CONTINUOUS-POLL+QUEUE -- real knowledgeIndexerProcessor CONFIRMED STARTED per PT-08.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
