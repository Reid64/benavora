// PT-09-003 execution proof: AG-25 (Disaster Response)
// registryAgentId ag-25-disaster-response / src/lib/agents/disaster-response-agent.ts
//
// Two plain functions (no agent_type enum value, no agent_runs row, matches
// the sendMorningDigest pattern per the file's own header): pollFEMADeclarations
// (real fetch against FEMA's OpenFEMA v2 API) and deployDisasterResponse
// (marks a declaration deployed for one org + raises an alert). This script
// calls both for real against the local pt05-local-stack.
//
// LOCAL SCAFFOLDING NOTE: disaster_declarations/disaster_emergency_funds did
// not exist locally -- applied via _fix-missing-tables-2.mjs this session.
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/AG-25-disaster-response.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-003-lib.mjs";

setupLocalEnv();

const { pollFEMADeclarations, deployDisasterResponse } = await import(
  "../../../src/lib/agents/disaster-response-agent.ts"
);

const CANONICAL = "AG-25 (Disaster Response)";
const WRITE_TABLES = ["disaster_declarations", "alerts"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();
  const before = {
    disaster_declarations: await countRows(db, "disaster_declarations"),
    alerts: await countRows(db, "alerts", "organization_id", orgId),
  };

  const supabase = makeLocalSupabaseClient();

  const log = [];
  let errorSurfaced = null;
  let pollResult = null;
  let deployResult = null;

  try {
    pollResult = await pollFEMADeclarations(supabase);
    log.push(`pollFEMADeclarations() resolved: ${JSON.stringify(pollResult)}`);

    // Real trigger for a real deployment: use a newly-polled declaration if
    // FEMA returned one this run, otherwise fall back to any existing
    // declaration row (real production behaviour: deployDisasterResponse is
    // chained per-declaration by the worker, independent of whether the
    // declaration was inserted this exact run).
    let declarationId = pollResult.newDeclarationIds[0] ?? null;
    if (!declarationId) {
      const existing = await db.query(
        "select id from disaster_declarations order by created_at desc limit 1",
      );
      declarationId = existing.rows[0]?.id ?? null;
    }

    if (declarationId) {
      deployResult = await deployDisasterResponse(declarationId, orgId, supabase);
      log.push(`deployDisasterResponse(${declarationId}, ${orgId}) resolved: ${JSON.stringify(deployResult)}`);
    } else {
      log.push("No disaster_declarations row available (FEMA returned none and none pre-existed) -- deployDisasterResponse not called.");
    }
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  }

  const after = {
    disaster_declarations: await countRows(db, "disaster_declarations"),
    alerts: await countRows(db, "alerts", "organization_id", orgId),
  };

  const declRows = (await db.query("select * from disaster_declarations order by created_at desc limit 3")).rows;
  const alertRows = (
    await db.query(
      "select * from alerts where organization_id=$1 and dedup_key like 'disaster-response:%' order by created_at desc limit 3",
      [orgId],
    )
  ).rows;

  await db.end();

  const delta = {};
  for (const k of Object.keys(before)) delta[k] = after[k] - before[k];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `pollFEMADeclarations()/deployDisasterResponse() threw past this harness: ${errorSurfaced}. This is a real, live outbound fetch to FEMA's public OpenFEMA v2 API (no mock) -- this could reflect a FEMA-side outage/schema change, or a real code defect. See triggerLog for which of the two calls failed.`;
  } else if (deployResult?.alertCreated) {
    verdict = "WORKS";
    reasoning = `pollFEMADeclarations() made a real, live call to FEMA's OpenFEMA v2 API (the capital-D "DisasterDeclarationsSummaries" endpoint fixed 2026-08-07) and returned ${pollResult.newCount} newly-inserted declaration(s) this run (real network result -- may legitimately be 0 if this local table already had every current FEMA declaration from an earlier run). deployDisasterResponse() then ran against a real declaration row and produced a real alert: matchedFunds=${deployResult.matchedFunds}, alertCreated=true. rowDelta.alerts=${delta.alerts}. This confirms both halves of AG-25's real Disaster Response pipeline function end-to-end against the live FEMA API.`;
  } else if (pollResult && !deployResult) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `pollFEMADeclarations() ran cleanly against the real FEMA API (newCount=${pollResult.newCount}) but no disaster_declarations row was available at all (neither newly polled nor pre-existing) to pass to deployDisasterResponse(), so the second half of the pipeline was never exercised. This is a seed-data gap (no declarations exist yet locally and FEMA returned 0 new ones this run), not a confirmed code defect in deployDisasterResponse() itself.`;
  } else if (pollResult && deployResult && !deployResult.alertCreated) {
    verdict = "ERROR-SWALLOWED";
    reasoning = `Both functions ran without throwing, but deployDisasterResponse()'s own alerts insert failed (alertCreated=false) -- the function swallows the insert error internally (\`alertCreated: !alertError\`) rather than surfacing it. declaration_id=${deployResult.declarationId}, matchedFunds=${deployResult.matchedFunds}.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither pollFEMADeclarations() nor deployDisasterResponse() produced a result and no error was surfaced.";
  }

  const resultObj = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-25-disaster-response",
    implementingFile: "src/lib/agents/disaster-response-agent.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct function invocation via tsx against the local pt05-local-stack: pollFEMADeclarations(supabase) (real live fetch to FEMA's OpenFEMA v2 API) then deployDisasterResponse(declarationId, orgId, supabase). Plain-function family (no agent_type/agent_runs row by design, per the file's own header -- matches the sendMorningDigest pattern). Real trigger path per pt09-001/agent-inventory.json: worker/scheduler.ts 'AG-25 disaster response pipeline (FEMA poll)' job (hour 5, minute 45), CONFIRMED STARTED+firing live per PT-08.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      disaster_declarations_rows: declRows,
      alerts_rows: alertRows,
      pollResult,
      deployResult,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SCHEDULED (registry metadata stale: claims manual, is actually scheduled).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT" || verdict === "TRIGGER-BROKEN" || verdict === "ERROR-SWALLOWED",
  };

  writeAgentResult(CANONICAL, resultObj);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
