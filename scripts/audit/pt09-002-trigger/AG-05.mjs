// PT-09-002 execution proof: AG-05 (ag-05-research / research family)
// Trigger method: direct class invocation of ONE representative member of the
// ~10-file research family -- src/lib/agents/research/corporate-giving.ts,
// class CorporateGivingResearchAgent extends BaseAgent -- matching its real
// manual-API trigger path (src/app/api/agents/research/route.ts) per
// pt09-001/agent-inventory.json.
//
// NOT directly executed this run (documented per task instructions so this
// is never overclaimed as full-family coverage): foundation-grants.ts,
// government-grants.ts, local-sponsorship.ts, grants-gov.ts, sam-gov.ts,
// nofa-parser.ts, usaspending.ts, simpler-grants.ts, state-portal.ts,
// custom-api.ts.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-05.mjs

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

const { CorporateGivingResearchAgent } = await import(
  "../../../src/lib/agents/research/corporate-giving.ts"
);

const CANONICAL = "AG-05";
const WRITE_TABLES = ["opportunities", "funders", "agent_runs", "opportunity_keywords"];
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

  const db = await pgClient();

  // Seed a real, active, corporate-category search profile for this org --
  // environment.json seeds no search_profiles rows, and this agent's
  // resolveProfiles() (no profileIds passed) only considers active profiles
  // carrying a corporate category (CORPORATE_CATEGORIES).
  const profileInsert = await db.query(
    `insert into search_profiles
       (organization_id, name, keywords, categories, geographic_scope, is_active, results_count)
     values ($1, $2, $3, $4, $5, true, 0)
     returning id`,
    [
      orgId,
      "PT-09 Audit Corporate Giving Profile",
      ["housing", "workforce development"],
      ["corporate_donation"],
      "Central Texas",
    ],
  );
  const profileId = profileInsert.rows[0].id;

  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();

  const log = [];
  log.push(`Seeded search_profiles row ${profileId} (corporate_donation, Central Texas, active).`);
  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new CorporateGivingResearchAgent({
      client: supabase,
      organizationId: orgId,
    });
    // No profileIds -> "run all active corporate profiles" path, exactly the
    // manual-API route's default sweep behavior.
    runOutcome = await withTimeout(
      agent.run({}),
      RUN_TIMEOUT_MS,
      "CorporateGivingResearchAgent.run()",
    );
    log.push(`agent.run() resolved: runId=${runOutcome.runId} tokensUsed=${runOutcome.tokensUsed} durationMs=${runOutcome.durationMs}`);
    log.push(`data: ${JSON.stringify(runOutcome.data)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {};
  for (const t of WRITE_TABLES) after[t] = await countRows(db, t, "organization_id", orgId);

  const runRow = runOutcome?.runId
    ? (await db.query("select * from agent_runs where id = $1", [runOutcome.runId])).rows[0]
    : null;
  const newOpp = await latestRow(db, "opportunities", "organization_id", orgId, "created_at");
  const newFunder = await latestRow(db, "funders", "organization_id", orgId, "created_at");
  const profileAfter = (
    await db.query("select last_run_at, results_count from search_profiles where id = $1", [profileId])
  ).rows[0];

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning =
      "agent.run() threw (or the harness timeout fired); the error was captured by this harness (not silently swallowed by the app), but no successful run completed. Classified ERROR-SWALLOWED per the taxonomy's harness-caught convention.";
  } else if (delta.agent_runs > 0 && delta.opportunities > 0 && newOpp && newOpp.source === "PT-09 Audit Corporate Giving Profile") {
    verdict = "WORKS";
    reasoning =
      "agent_runs row written, a real opportunity was discovered and inserted from a live web search + Claude extraction pass, source-tagged with the seeded profile's name exactly as the code does -- matches AG-05/corporate-giving's documented intent (profile-driven web discovery -> structured opportunity insert).";
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning =
      `agent_runs row was written and the run resolved cleanly (profilesRun/opportunitiesFound in data: ${JSON.stringify(runOutcome?.data)}), but zero opportunities/funders were created. This is expected/plausible given the run's real dependency on scraping live Google search results (see triggerLog) -- a CAPTCHA/bot-block or zero qualifying candidate pages on this run would produce exactly this shape. Flagged as the dangerous "ran clean, wrote nothing" class per the taxonomy regardless of the plausible external cause.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "agent_runs was never written and no error was surfaced -- the invocation never reached BaseAgent.run()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-05-research",
    implementingFile: "src/lib/agents/research/corporate-giving.ts (ONE representative member of the ag-05-research family -- see verdictReasoning for what was NOT tested)",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new CorporateGivingResearchAgent({ client, organizationId }).run({}) against a freshly seeded active search_profiles row (corporate_donation category, Central Texas). Matches the real manual-API trigger path (src/app/api/agents/research/route.ts) per agent-inventory.json triggerWiredVerdict WIRED-MANUAL-API. Makes real, live outbound web-search/fetch calls (search-engine.ts -> Google results page scrape) and, if any candidate page is fetched, a real Claude extraction call (result-parser.ts) -- no mocking.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      opportunities_inserted: newOpp && newOpp.created_at > before ? { id: newOpp.id, name: newOpp.name, funder_id: newOpp.funder_id, category: newOpp.category, source: newOpp.source, url: newOpp.url, created_at: newOpp.created_at } : null,
      funders_inserted: newFunder ? { id: newFunder.id, name: newFunder.name, category: newFunder.category, notes: newFunder.notes } : null,
      agent_runs_row: runRow ?? null,
      search_profiles_after: profileAfter ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning:
      reasoning +
      " IMPORTANT SCOPE NOTE: only 1 of the ~10 files that make up the ag-05-research umbrella (per agent-inventory.json's note) was directly executed this run -- src/lib/agents/research/corporate-giving.ts. NOT executed: src/lib/agents/research/foundation-grants.ts, src/lib/agents/research/government-grants.ts, src/lib/agents/research/local-sponsorship.ts, src/lib/agents/research/grants-gov.ts, src/lib/agents/research/sam-gov.ts, src/lib/agents/research/nofa-parser.ts, src/lib/agents/research/usaspending.ts, src/lib/agents/research/simpler-grants.ts, src/lib/agents/research/state-portal.ts, src/lib/agents/research/custom-api.ts. Per agent-inventory.json's own prior finding (STATE_OF_THE_BUILD.md 2026-08-04), several of those siblings have their own DISTINCT, documented breakage (grants_gov_research hangs indefinitely, simpler_grants_research 401s, state_portal 404s, custom_api_research schema error) not exercised or re-verified by this single-member test. This result speaks ONLY to corporate-giving.ts.",
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-MANUAL-API (manual: src/app/api/agents/research/route.ts, plus /status and /quality sibling routes).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
