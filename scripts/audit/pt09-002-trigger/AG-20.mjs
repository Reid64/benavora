// PT-09-002 execution proof: AG-20 (ea01_giving_detector /
// src/lib/agents/ea-01-giving-detector.ts, class EA01GivingDetectorAgent
// extends BaseAgent)
//
// Trigger: new EA01GivingDetectorAgent({ client, organizationId }).run({
// prospectId }) -- this file's own header documents it as invoked directly
// with a prospectId (no queue/dispatcher wiring exists), the same pattern
// AG-01 (grant-summary) uses. Writes corporate_prospects.enrichment via the
// shared corporate-enrichment-shared.ts helper (mergeEnrichmentPatch).
//
// Uses one of the seeded corporateProspects rows. Its website is a
// synthetic *.example domain (non-resolvable) -- this is real seed data, not
// something this script invents, so the real network fetch will genuinely
// fail to resolve any of the 3 candidate pages (/giving, /csr, /community).
// That is not a stub: it exercises the agent's own explicitly-coded
// zero-pages-found branch (mergeEnrichmentPatch({has_giving_program:false})),
// which the file documents as intentional, real behavior -- counted as a
// real, intent-matching write, not a fabricated stub, and noted honestly
// here rather than papered over as a "happy path" success.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-20.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { EA01GivingDetectorAgent } = await import("../../../src/lib/agents/ea-01-giving-detector.ts");

const CANONICAL = "AG-20";
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
  const prospectId = env.corporateProspects[0];

  const db = await pgClient();
  const before = (await db.query("select * from corporate_prospects where id = $1", [prospectId])).rows[0];
  const runsBefore = (await db.query("select count(*)::int as n from agent_runs where organization_id = $1", [orgId])).rows[0].n;

  const supabase = makeLocalSupabaseClient();
  const log = [];
  log.push(`Target corporate_prospects row: ${prospectId} (legal_name=${before?.legal_name}, website=${before?.website}, enrichment_version=${before?.enrichment_version}).`);

  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new EA01GivingDetectorAgent({ client: supabase, organizationId: orgId });
    runOutcome = await withTimeout(
      agent.run({ prospectId }),
      RUN_TIMEOUT_MS,
      "EA01GivingDetectorAgent.run()",
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
      `agent_runs row written, corporate_prospects.enrichment genuinely patched (enrichment_version ${before?.enrichment_version} -> ${after?.enrichment_version}) via a real BaseAgent execute() pass -- matches AG-20/EA-01's documented intent. Result: has_giving_program=${runOutcome?.data?.hasGivingProgram}, pagesFound=${runOutcome?.data?.pagesFound}. NOTE: the seeded prospect's website (${before?.website}) is a synthetic *.example domain and did not resolve, so this run exercised the agent's own documented "zero pages found -> has_giving_program:false" branch, not the full Claude-extraction happy path -- this is real, intentional agent behavior per the file's own code (not a stub), but is a narrower proof than a resolvable real-world website would give. See verdictReasoning caveat.`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs completed cleanly but corporate_prospects.enrichment was never patched. run outcome: ${runOutcome ? JSON.stringify(runOutcome) : "n/a"}.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor corporate_prospects changed, and no error was surfaced -- the invocation never reached BaseAgent.run()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ea01_giving_detector",
    implementingFile: "src/lib/agents/ea-01-giving-detector.ts (writes via src/lib/agents/corporate-enrichment-shared.ts)",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new EA01GivingDetectorAgent({ client, organizationId }).run({ prospectId }) against a seeded corporate_prospects row -- exactly the invocation pattern this file's own header documents as its real (queue-less, direct) trigger. Real StealthEngine/Playwright fetch attempts against the seeded website's 3 candidate paths (/giving, /csr, /community); a real Claude call only fires if at least one page is fetched.",
    before: before ? { id: before.id, legal_name: before.legal_name, website: before.website, enrichment: before.enrichment, enrichment_version: before.enrichment_version } : null,
    after: after ? { id: after.id, legal_name: after.legal_name, website: after.website, enrichment: after.enrichment, enrichment_version: after.enrichment_version } : null,
    rowDelta: delta,
    sampleWrittenRow: after ? { id: after.id, legal_name: after.legal_name, enrichment: after.enrichment, enrichment_version: after.enrichment_version, enrichment_completed_at: after.enrichment_completed_at } : null,
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: NOT-WIRED (DEFINED-NOT-STARTED per PT-08) -- worker/enrichment-processor.ts's EA-01..EA-10 pipeline is a documented boot step never actually started/reachable via any queue. FEATURE_REGISTRY_v2.md row #90 ('Corporate Enrichment Agents EA-01 to EA-10 (AG-20/AG-21 + 8 more)'): status 'BUILT — VERIFIED (EA-01/EA-08); BUILT — UNVERIFIED (EA-02–07/09/10)' -- \"Re-verified live 2026-08-03: EA01GivingDetectorAgent.run({prospectId}) ... complete cleanly against a real SAM.gov-sourced prospect (correctly took the documented no-website graceful path). The independent accuracy defect found July 30 is unchanged: both agents' hardcoded candidate-path lists missed real content for 2-3 of 3 test companies ... because real pages often live on a different subdomain/path than the 2-3 guesses tried. Caveat unchanged: this orchestrator is not called from worker/index.ts's boot sequence -- on-demand only.\" This session's result (zero pages found against a non-resolvable seed domain) is consistent with, not contradicting, that prior finding's own caveat about the fixed candidate-path list's real-world hit rate.",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
