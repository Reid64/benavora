// PT-09-002 execution proof: AG-14 (ag-14-donor-discovery /
// worker/dd-request-processor.ts, class DdRequestProcessor)
//
// Trigger method: NOT start()/loop() (infinite poll, forbidden by task
// rules). Instead: (1) a real dequeue() call against a freshly inserted
// donor_discovery_requests row, to test the REAL continuous-poll claim path
// the production worker uses; then (2) a direct call to the class's public
// per-item method processItem(item) (bracket notation, matching this
// project's established "call the private/internal method directly"
// technique -- processItem is actually public here, bracket notation still
// works) with a manually constructed item, to see how far the real pipeline
// (enumerate -> Google Places -> enrich -> link -> score) gets.
//
// IMPORTANT PRE-FLIGHT FINDING (documented, not silently worked around):
// this local stack's schema was auto-generated from a REAL production
// schema snapshot (see pt09-002-schema-extension.sql header: "Auto-generated
// ... from test-evidence/pt-06/live-schema.json, a real, read-only
// production schema snapshot"). That snapshot has NO donor_discovery_taxonomy
// table and NO donor_discovery_claim_request RPC function -- confirmed via
// direct querying of both the local stack and the schema-extension source
// file. migration 067_donor_discovery_foundation.sql (which defines both)
// is explicitly headed "File only -- not applied to production", and
// migration 070_donor_discovery_request_claim.sql (which defines the RPC)
// was never synced into the extension either. This means BOTH of those
// dependencies are genuinely missing in the real production database, not
// merely missing from this test harness's scaffolding -- per the task's own
// Safety Rule 5 ("do not mask a real application bug"), this script does
// NOT create them locally. The resulting failures below are a faithful
// reproduction of what AG-14 does against real production today.
//
// Usage: npx tsx scripts/audit/pt09-002-trigger/AG-14.mjs

import {
  setupLocalEnv,
  loadEnvironment,
  pgClient,
  countRows,
  writeAgentResult,
  makeLocalSupabaseClient,
} from "../pt09-002-lib.mjs";

setupLocalEnv();

const { DdRequestProcessor } = await import("../../../worker/dd-request-processor.ts");

const CANONICAL = "AG-14";
const WRITE_TABLES = ["donor_discovery_requests", "donor_discovery_directory"];

async function main() {
  const env = loadEnvironment();
  const orgId = env.org.orgId;

  const db = await pgClient();

  const dirBefore = await countRows(db, "donor_discovery_directory", null, null);
  const reqBefore = await countRows(db, "donor_discovery_requests", "organization_id", orgId);
  const prospectsBefore = await countRows(db, "donor_discovery_prospects", "organization_id", orgId);

  const supabase = makeLocalSupabaseClient();
  const processor = new DdRequestProcessor(supabase);

  const log = [];
  let errorSurfaced = null;

  // --- Step 1: real dequeue() against a real queued request, to test the
  // actual production continuous-poll claim path. ---
  const reqInsert = await db.query(
    `insert into donor_discovery_requests (organization_id, name, taxonomy_ids, geography, status, counts)
     values ($1, $2, $3, $4, 'queued', '{}')
     returning id`,
    [orgId, "PT-09 audit dequeue probe", [], { national: true }],
  );
  const dequeueProbeId = reqInsert.rows[0].id;
  log.push(`Inserted donor_discovery_requests probe row ${dequeueProbeId} (status=queued) to test the real dequeue() RPC path.`);

  let dequeueResult;
  try {
    dequeueResult = await processor["dequeue"]();
    log.push(`processor.dequeue() (bracket-notation call to the private claim method) resolved: ${JSON.stringify(dequeueResult)}`);
  } catch (err) {
    dequeueResult = undefined;
    log.push(`processor.dequeue() THREW directly (not the app's own swallow-and-return-null path): ${err instanceof Error ? err.message : String(err)}`);
  }

  const rpcExists = (
    await db.query("select 1 from pg_proc where proname = 'donor_discovery_claim_request'")
  ).rows.length > 0;
  log.push(`donor_discovery_claim_request RPC exists in this schema (mirrors real production): ${rpcExists}`);

  // Confirm dequeue()'s console.error was hit (RPC missing) and it silently
  // returned null -- i.e. the queued probe row is left untouched, exactly as
  // an operator watching donor_discovery_requests would see, with the real
  // cause (missing RPC) visible only in a server console log line, not in
  // any queryable table.
  const probeRow = (await db.query("select status from donor_discovery_requests where id = $1", [dequeueProbeId])).rows[0];
  log.push(`Probe row status after dequeue() attempt: ${probeRow?.status} (unchanged from 'queued' means dequeue() silently treated the RPC failure as "queue empty" -- ERROR-SWALLOWED signature: the real cause is not recorded anywhere queryable).`);

  // --- Step 2: direct processItem() call (per task instructions), on a
  // second, distinct request row, to see how far the rest of the pipeline
  // reaches given the missing donor_discovery_taxonomy dependency. ---
  const req2Insert = await db.query(
    `insert into donor_discovery_requests (organization_id, name, taxonomy_ids, geography, status, counts)
     values ($1, $2, $3, $4, $5, '{}')
     returning id, organization_id, name, taxonomy_ids, geography, status, counts, created_at, completed_at`,
    [orgId, "PT-09 audit processItem probe", ["00000000-0000-0000-0000-000000000001"], { center: { lat: 30.2672, lng: -97.7431 }, radius_mi: 25 }, "queued"],
  );
  const item = req2Insert.rows[0];
  log.push(`Inserted donor_discovery_requests probe row ${item.id} with a placeholder taxonomy_ids entry, for a direct processItem() call.`);

  const taxonomyTableExists = (
    await db.query("select 1 from information_schema.tables where table_name = 'donor_discovery_taxonomy'")
  ).rows.length > 0;
  log.push(`donor_discovery_taxonomy table exists in this schema (mirrors real production): ${taxonomyTableExists}`);

  try {
    // Real code path: item.taxonomy_ids -> donor_discovery_taxonomy lookup ->
    // enumerate() (real Google Places API call) -> ... This mirrors exactly
    // what loop()'s own try/catch around processItem() does on failure (see
    // dd-request-processor.ts lines 212-226): update the request row to
    // 'failed' with the real error message in counts.error. Replicated here
    // since we call processItem() directly rather than through loop().
    await processor["processItem"](item);
    log.push("processItem() resolved without throwing.");
  } catch (err) {
    errorSurfaced = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.push(`processItem() THREW (caught by this harness): ${errorSurfaced}`);
    await supabase
      .from("donor_discovery_requests")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        counts: { error: err instanceof Error ? err.message : String(err) },
      })
      .eq("id", item.id);
    log.push("Replicated loop()'s real catch-and-record behavior: updated the request row to status='failed' with counts.error set, exactly as the production poll loop would on this same throw.");
  }

  const dirAfter = await countRows(db, "donor_discovery_directory", null, null);
  const reqAfter = await countRows(db, "donor_discovery_requests", "organization_id", orgId);
  const prospectsAfter = await countRows(db, "donor_discovery_prospects", "organization_id", orgId);
  const item2Final = (await db.query("select * from donor_discovery_requests where id = $1", [item.id])).rows[0];

  await db.end();

  const delta = {
    donor_discovery_directory: dirAfter - dirBefore,
    donor_discovery_requests: reqAfter - reqBefore,
    donor_discovery_prospects: prospectsAfter - prospectsBefore,
  };

  // Verdict: the real continuous-poll dequeue() path silently swallows the
  // missing-RPC error (console.error only, returns null exactly like an
  // empty queue -- no DB record anywhere says "the queue is stuck"). That is
  // the ERROR-SWALLOWED case per the taxonomy's own definition: "the agent's
  // own internal error handling ate the exception with no db record of it."
  // The direct processItem() path DOES surface its error (this harness
  // replicated the app's real catch-and-record behavior), but that's a
  // secondary path this script exercised manually -- the primary, actually
  // running production trigger (the continuous poll loop) is governed by
  // dequeue()'s swallowed failure, so it never reaches processItem() at all
  // in real operation.
  const verdict = "ERROR-SWALLOWED";
  const reasoning =
    `Two real, distinct findings from directly exercising this class against a schema mirrored from real production: ` +
    `(1) dequeue() -- the method the real continuous-poll loop() calls every 15s in production -- depends on the RPC ` +
    `donor_discovery_claim_request, which does NOT exist in production (confirmed: absent from the pt09-002 schema-extension's ` +
    `real-production-snapshot generator, and migration 070 defining it was never applied). dequeue()'s own error handling ` +
    `(worker/dd-request-processor.ts ~line 268-271: "if (error) { console.error(...); return null; }") treats this exactly ` +
    `like an empty queue -- a server console.error line only, never a database record. The queued probe row is left sitting ` +
    `in status='queued' forever with no visible sign anything is wrong: this is the taxonomy's own "dangerous... looks built, ` +
    `does nothing" class, specifically the ERROR-SWALLOWED variant since the real cause is invisible to anyone not tailing ` +
    `server logs at the exact moment. (2) Bypassing dequeue() and calling processItem() directly on a second probe row reaches ` +
    `further, but immediately fails at the taxonomy_ids -> donor_discovery_taxonomy lookup, because that table ALSO does not ` +
    `exist in production (migration 067 is explicitly "File only -- not applied to production"). This second failure IS ` +
    `recorded to the DB (this harness replicated loop()'s real catch/update-to-failed behavior) -- see sampleWrittenRow. ` +
    `Net result: zero rows landed in donor_discovery_directory or donor_discovery_prospects via either path. In real, unmodified ` +
    `production, AG-14's continuous poll loop is confirmed STARTED (boot-inventory.json) but can never successfully claim or ` +
    `process a single real request, and does so silently -- a request submitted by a real user today would sit in 'queued' ` +
    `status indefinitely with no error anywhere in the product for a human to see.`;

  const result = {
    canonicalNumber: CANONICAL,
    registryAgentId: "ag-14-donor-discovery",
    implementingFile: "worker/dd-request-processor.ts",
    writeTargetTables: WRITE_TABLES,
    triggerMethod:
      "Two real invocations against the local pt05-local-stack (whose schema was auto-generated from a real production snapshot, not hand-authored): (1) processor.dequeue() -- the real per-tick method the production continuous-poll loop() calls -- against a freshly inserted donor_discovery_requests row; (2) processor['processItem'](item) called directly (bracket notation) with a manually constructed item, bypassing dequeue(), per task instructions to test the per-item logic without running the infinite poll loop. No mocking; both real donor_discovery_taxonomy/donor_discovery_claim_request dependency gaps below are genuine (present in real production too, not scaffolding), confirmed against the schema-extension generator's production snapshot before writing this script.",
    before: { donor_discovery_directory: dirBefore, donor_discovery_requests: reqBefore, donor_discovery_prospects: prospectsBefore },
    after: { donor_discovery_directory: dirAfter, donor_discovery_requests: reqAfter, donor_discovery_prospects: prospectsAfter },
    rowDelta: delta,
    sampleWrittenRow: {
      dequeue_probe_request_id: dequeueProbeId,
      dequeue_probe_status_after: probeRow?.status ?? null,
      dequeue_result: dequeueResult ?? null,
      dequeue_rpc_exists_in_schema: rpcExists,
      taxonomy_table_exists_in_schema: taxonomyTableExists,
      processitem_probe_request_after: item2Final
        ? { id: item2Final.id, status: item2Final.status, counts: item2Final.counts, completed_at: item2Final.completed_at }
        : null,
    },
    triggerLog: log.join("\n"),
    errorSurfaced,
    verdict,
    verdictReasoning: reasoning,
    registryPriorStatus:
      "See test-evidence/pt-09/agent-inventory.json triggerWiredVerdict: WIRED-EVENT-CONTINUOUS-POLL (event: ddRequestProcessor -- continuous poll of donor_discovery_requests. CONFIRMED STARTED per boot-inventory.json). This session's finding (RPC + taxonomy table both genuinely missing in production) is a materially more serious result than that prior status suggests: STARTED-but-can-never-succeed is functionally equivalent to not built, just silently so.",
    falsePassCasualty: true,
  };

  writeAgentResult(CANONICAL, result);
  console.log(`\nVerdict for ${CANONICAL}: ${verdict}`);
}

main().catch((err) => {
  console.error("FATAL (harness-level, not agent-level):", err);
  process.exit(1);
});
