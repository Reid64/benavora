// PT-09-002 execution proof: AG-21 (ea08_executive_biography_analyzer /
// src/lib/agents/ea-08-executive-biography-analyzer.ts, class
// EA08ExecutiveBiographyAnalyzerAgent extends BaseAgent)
//
// Trigger: new EA08ExecutiveBiographyAnalyzerAgent({ client, organizationId
// }).run({ prospectId }). File header confirms: "Trigger: post-acquisition
// (same as EA-01/EA-05/EA-09 -- no upstream EA-0X dependency)" -- explicitly
// no dependency on AG-20/EA-01 having run first, so this was checked and
// does NOT need EA-01 seeded first. Writes corporate_prospects.enrichment
// via the same corporate-enrichment-shared.ts helper AG-20 uses.
//
// Uses the SECOND seeded corporateProspects row (distinct from AG-20's
// target, so the two scripts' writes don't collide on the same row) --
// also a synthetic *.example, non-resolvable website. Per this file's own
// header, EA-08 ALWAYS writes a patch once it has a website to try
// (including an explicit empty-array result when no leadership pages are
// found), specifically so EA-10 never blocks forever -- so even the
// zero-pages-found branch here is real, intentional, documented write
// behavior, not a stub.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-21.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { EA08ExecutiveBiographyAnalyzerAgent } = await import(
  "../../../src/lib/agents/ea-08-executive-biography-analyzer.ts"
);

const CANONICAL = "AG-21";
const WRITE_TABLES = ["corporate_prospects", "agent_runs"];
const RUN_TIMEOUT_MS = 100_000;

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
  const prospectId = env.corporateProspects[1]; // distinct from AG-20's target

  const db = await pgClient();
  const before = (await db.query("select * from corporate_prospects where id = $1", [prospectId])).rows[0];
  const runsBefore = (await db.query("select count(*)::int as n from agent_runs where organization_id = $1", [orgId])).rows[0].n;

  const supabase = makeLocalSupabaseClient();
  const log = [];
  log.push(`Target corporate_prospects row: ${prospectId} (legal_name=${before?.legal_name}, website=${before?.website}, enrichment_version=${before?.enrichment_version}). Deliberately distinct row from AG-20's target to avoid write collisions between the two scripts.`);
  log.push("Confirmed via file header: EA-08 has no upstream EA-0X dependency (unlike some other EA agents), so this is a valid standalone invocation.");

  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new EA08ExecutiveBiographyAnalyzerAgent({ client: supabase, organizationId: orgId });
    runOutcome = await withTimeout(
      agent.run({ prospectId }),
      RUN_TIMEOUT_MS,
      "EA08ExecutiveBiographyAnalyzerAgent.run()",
    );
    log.push(`agent.run() resolved: runId=${runOutcome.runId} tokensUsed=${runOutcome.tokensUsed} durationMs=${runOutcome.durationMs}`);
    log.push(`data: ${JSON.stringify(runOutcome.data)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = (await db.query("select * from corporate_prospects where id = $1", [prospectId])).rows[0];
  const runsAfter = (await db.query("select count(*)::int as n from agent_runs where organization_id = $1", [orgId])).rows[0].n;
  const runRow = runOutcome?.runId
    ? (await db.query("select * from agent_runs where id = $1", [runOutcome.runId])).rows[0]
    : null;

  await db.end();

  const delta = {
    agent_runs: runsAfter - runsBefore,
    enrichment_version_delta: (after?.enrichment_version ?? 0) - (before?.enrichment_version ?? 0),
    enrichment_changed: JSON.stringify(before?.enrichment ?? {}) !== JSON.stringify(after?.enrichment ?? {}),
  };

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw (or the harness timeout fired); caught by this harness (not silently swallowed by the app), but no successful write completed.";
  } else if (delta.agent_runs > 0 && delta.enrichment_changed && delta.enrichment_version_delta > 0) {
    verdict = "WORKS";
    reasoning =
      `agent_runs row written, corporate_prospects.enrichment genuinely patched (enrichment_version ${before?.enrichment_version} -> ${after?.enrichment_version}) via a real BaseAgent execute() pass -- matches AG-21/EA-08's documented intent (always-patch-once-a-website-exists, so EA-10's gate never blocks forever). Result: decisionMakerNames=${JSON.stringify(runOutcome?.data?.decisionMakerNames)}, pagesFound=${runOutcome?.data?.pagesFound}. NOTE: the seeded prospect's website (${before?.website}) is a synthetic *.example domain and did not resolve, so this run exercised the zero-pages-found branch (empty arrays written) -- real, intentional, documented behavior per the file's own header, not a stub, but a narrower proof than a resolvable real-world website with real leadership pages would give.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly but corporate_prospects.enrichment was never patched -- notably contradicts this file's own header claim that EA-08 "always writes a patch once it has a website to try." run outcome: ${runOutcome ? JSON.stringify(runOutcome) : "n/a"}.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor corporate_prospects changed, and no error was surfaced -- the invocation never reached BaseAgent.run()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ea08_executive_biography_analyzer",
    implementingFile: "src/lib/agents/ea-08-executive-biography-analyzer.ts (writes via src/lib/agents/corporate-enrichment-shared.ts)",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new EA08ExecutiveBiographyAnalyzerAgent({ client, organizationId }).run({ prospectId }) against a seeded corporate_prospects row (distinct from AG-20's target row). Confirmed no upstream EA-0X dependency from the file's own header before running standalone. Real StealthEngine/Playwright fetch attempts against the seeded website's 2 candidate paths (/leadership, /about/team); a real Claude call only fires if at least one page is fetched.",
    before: before ? { id: before.id, legal_name: before.legal_name, website: before.website, enrichment: before.enrichment, enrichment_version: before.enrichment_version } : null,
    after: after ? { id: after.id, legal_name: after.legal_name, website: after.website, enrichment: after.enrichment, enrichment_version: after.enrichment_version } : null,
    rowDelta: delta,
    sampleWrittenRow: after ? { id: after.id, legal_name: after.legal_name, enrichment: after.enrichment, enrichment_version: after.enrichment_version, enrichment_completed_at: after.enrichment_completed_at } : null,
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: NOT-WIRED (DEFINED-NOT-STARTED per PT-08) -- same enrichment-processor finding as AG-20 (worker/enrichment-processor.ts's EA-01..EA-10 pipeline is a documented boot step never actually started/reachable via any queue). FEATURE_REGISTRY_v2.md row #90 ('Corporate Enrichment Agents EA-01 to EA-10 (AG-20/AG-21 + 8 more)'): status 'BUILT — VERIFIED (EA-01/EA-08); BUILT — UNVERIFIED (EA-02–07/09/10)' -- \"Re-verified live 2026-08-03: EA08ExecutiveBiographyAnalyzerAgent.run({prospectId}) ... complete[s] cleanly against a real SAM.gov-sourced prospect (correctly took the documented no-website graceful path). The independent accuracy defect found July 30 is unchanged: both agents' hardcoded candidate-path lists missed real content for 2-3 of 3 test companies (EA-08 0/6 hits) ... Caveat unchanged: this orchestrator is not called from worker/index.ts's boot sequence -- on-demand only.\"",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
