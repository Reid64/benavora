// PT-09-002 execution proof: AG-08 (ag-08-nofa-parser / src/lib/agents/nofa-parser.ts)
// Trigger method: direct class invocation, matching AG-01's proven pattern.
// Real trigger path per inventory: subroutine of the research/import pipeline
// (WIRED-SUBROUTINE) -- shares the logged agentType 'government_research'
// with two other unrelated classes. Invoked directly here as
// new NofaParserAgent({ client, organizationId }).run({ opportunityId }).
//
// This agent downloads real documents over HTTP and extracts fields via a
// real Claude call. To make the proof deterministic and avoid depending on a
// live grants.gov URL's exact HTML shape, this script spins up a throwaway
// local HTTP server (127.0.0.1, ephemeral port) serving a crafted NOFA-like
// HTML announcement -- a real HTTP fetch + real HTML-stripping + real Claude
// extraction call, just against a document we control instead of an
// unstable third-party URL. This is not a third-party send (nothing is
// submitted anywhere); it is the agent reading a document, exactly like it
// would read a real grants.gov attachment.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-08.mjs

import http from "node:http";
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

const { NofaParserAgent } = await import("../../../src/lib/agents/nofa-parser.ts");

const CANONICAL = "AG-08";
const WRITE_TABLES = ["opportunities", "agent_runs"];

const NOFA_HTML = `<!DOCTYPE html>
<html><head><title>PT-09 NOFA Test Announcement</title></head>
<body>
<h1>Notice of Funding Availability: PT-09 Rural Workforce Housing Initiative</h1>
<p>The PT-09 Federal Housing Program announces the availability of $250,000 to $500,000
in grant funding for eligible 501(c)(3) organizations serving rural and low-income
communities in Central Texas.</p>
<p>Eligibility: applicants must be a 501(c)(3) nonprofit with at least 3 years of
operating history providing workforce housing or transitional housing services.</p>
<p>Geographic restrictions: Central Texas counties only.</p>
<p>Applications must be submitted through Grants.gov and include a Form 990, a
current board list, and a program narrative. Application method: online portal
submission via Grants.gov.</p>
<p>This is an annually recurring program; the next cycle opens one year after this
announcement.</p>
<p>Deadline: 2026-12-01.</p>
</body></html>`;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(NOFA_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/pt09-nofa.html` });
    });
  });
}

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;
  // Opportunity 2: application_method/recurrence/geographic_restrictions/
  // amount_available are all still null on this row (confirmed via direct
  // query before writing this script), so NOFA enrichment has real empty
  // fields to fill without colliding with AG-02's/AG-01's write columns.
  const opp = env.opportunities[1];

  const { server, url } = await startServer();
  const log = [`Started local test-fixture HTTP server at ${url}`];

  const db = await pgClient();

  // Seed opportunity_documents so the agent has something to download.
  await db.query(
    "update opportunities set opportunity_documents = $1::jsonb where id = $2",
    [JSON.stringify([{ title: "PT-09 NOFA Test Announcement", url }]), opp.id],
  );
  log.push(`Seeded opportunities.opportunity_documents = [{ title, url: ${url} }]`);

  const before = {};
  for (const t of WRITE_TABLES) before[t] = await countRows(db, t, "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();

  let errorSurfaced = null;
  let runOutcome = null;

  try {
    const agent = new NofaParserAgent({
      client: supabase,
      organizationId: orgId,
    });
    runOutcome = await agent.run({ opportunityId: opp.id });
    log.push(`agent.run() resolved: runId=${runOutcome.runId} tokensUsed=${runOutcome.tokensUsed} durationMs=${runOutcome.durationMs}`);
    log.push(`data: ${JSON.stringify(runOutcome.data)}`);
  } catch (err) {
    errorSurfaced = err instanceof Error ? err.stack ?? err.message : String(err);
    log.push(`THREW: ${errorSurfaced}`);
  } finally {
    server.close();
    log.push("Closed local test-fixture HTTP server.");
  }

  const after = {};
  for (const t of WRITE_TABLES) after[t] = await countRows(db, t, "organization_id", orgId);

  const oppRow = await latestRow(db, "opportunities", "id", opp.id, "updated_at");
  const runRow = runOutcome?.runId
    ? (await db.query("select * from agent_runs where id = $1", [runOutcome.runId])).rows[0]
    : null;

  await db.end();

  const delta = {};
  for (const t of WRITE_TABLES) delta[t] = after[t] - before[t];

  let verdict;
  let reasoning;
  if (errorSurfaced) {
    verdict = "ERROR-SWALLOWED";
    reasoning = "agent.run() threw; the error was captured by this harness (not silently swallowed by the app), but no successful write occurred. Classified ERROR-SWALLOWED since run() is where a caller would expect a clean result or a surfaced failure, and this is that failure.";
  } else if (
    delta.agent_runs > 0 &&
    runOutcome &&
    runOutcome.data.enrichedFields.length > 0 &&
    oppRow &&
    oppRow.application_method
  ) {
    verdict = "WORKS";
    reasoning = `agent_runs row written (real BaseAgent logging), real HTTP download + HTML strip + Claude extraction ran, and opportunities row patched with genuinely new fields (${runOutcome.data.enrichedFields.join(", ")}) that were previously null -- matches AG-08's documented intent (enrich an opportunity from a NOFA document, only filling empty fields).`;
  } else if (delta.agent_runs > 0) {
    verdict = "WIRED-NO-OUTPUT";
    reasoning = `agent_runs row was written (the run executed, pdfsProcessed=${runOutcome?.data?.pdfsProcessed ?? "?"}) but zero fields were actually enriched on the opportunity -- zero real business-table output despite a clean run.`;
  } else {
    verdict = "TRIGGER-BROKEN";
    reasoning = "Neither agent_runs nor opportunities changed, and no error was surfaced -- the invocation itself never reached BaseAgent.run()'s logging path.";
  }

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-08-nofa-parser",
    implementingFile: "src/lib/agents/nofa-parser.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Direct class invocation via tsx against the local pt05-local-stack: new NofaParserAgent({ client, organizationId }).run({ opportunityId }), with opportunities.opportunity_documents pre-seeded to point at a throwaway local HTTP server (127.0.0.1, ephemeral port) serving a crafted HTML NOFA announcement so the run exercises a real HTTP download + HTML text extraction + real Claude structured-extraction call end to end, without depending on an unstable third-party URL's exact document shape. Real trigger path (per pt09-001/agent-inventory.json) is WIRED-SUBROUTINE (invoked directly by its caller elsewhere in the research/import pipeline) -- this is that same construction pattern.",
    before,
    after,
    rowDelta: delta,
    sampleWrittenRow: {
      opportunities_patched: oppRow
        ? {
            id: oppRow.id,
            name: oppRow.name,
            application_method: oppRow.application_method,
            recurrence: oppRow.recurrence,
            geographic_restrictions: oppRow.geographic_restrictions,
            amount_available: oppRow.amount_available,
            updated_at: oppRow.updated_at,
          }
        : null,
      agent_runs_row: runRow ?? null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus: "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-SUBROUTINE (code exists, real write target, no autonomous trigger -- a manually-invoked subroutine of the research/import pipeline). Also notes agent_id mismatch: registry id 'ag-08-nofa-parser' matches no real agentType literal ever logged by this class (real logged literal is 'government_research', shared with 2 unrelated classes).",
    falsePassCasualty: verdict === "WIRED-NO-OUTPUT",
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
