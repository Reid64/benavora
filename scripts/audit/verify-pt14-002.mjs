#!/usr/bin/env node
/**
 * PT-14-002 verifier: fails unless test-evidence/pt-14/rls-anon-audit.json
 * records a real anon-access verdict for EVERY table in PT-06's live-schema
 * list (test-evidence/pt-06/live-schema.json), and a real policy verdict
 * for EVERY storage bucket the audit found live -- plus a handful of
 * internal-consistency checks so a stale or hand-edited file can't pass
 * silently.
 *
 * Exit 0 = pass, exit 1 = fail (prints the reason).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const AUDIT_PATH = join(ROOT, "test-evidence", "pt-14", "rls-anon-audit.json");
const PT06_SCHEMA_PATH = join(ROOT, "test-evidence", "pt-06", "live-schema.json");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(PT06_SCHEMA_PATH)) {
  fail(`${PT06_SCHEMA_PATH} does not exist. PT-06 must run before this verifier can check completeness against its schema list.`);
}
if (!existsSync(AUDIT_PATH)) {
  fail(`${AUDIT_PATH} does not exist. Run scripts/audit/pt14-004-anon-rls-storage-audit.mjs first.`);
}

let pt06Schema;
try {
  pt06Schema = JSON.parse(readFileSync(PT06_SCHEMA_PATH, "utf8"));
} catch (err) {
  fail(`PT-06 live-schema.json is not valid JSON: ${err.message}`);
}
const pt06Tables = Object.keys(pt06Schema.tables ?? {});
if (pt06Tables.length === 0) {
  fail("PT-06's live-schema.json has zero tables -- nothing to check completeness against.");
}

let audit;
try {
  audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8"));
} catch (err) {
  fail(`rls-anon-audit.json is not valid JSON: ${err.message}`);
}
if (!audit || typeof audit !== "object") fail("rls-anon-audit.json root is not an object.");

const { tables, buckets, rpcs, disputed_items_resolution: disputes, summary } = audit;

if (!tables || typeof tables !== "object") fail("rls-anon-audit.json is missing a `tables` object.");
if (!buckets || typeof buckets !== "object") fail("rls-anon-audit.json is missing a `buckets` object.");
if (!summary || typeof summary !== "object") fail("rls-anon-audit.json is missing a `summary` object.");

// ---- Requirement 1: every table from PT-06's schema has an anon-access verdict ----
const VALID_TABLE_VERDICTS = new Set([
  "ANON_BLOCKED_NO_GRANT",
  "ANON_BLOCKED_BY_RLS",
  "ANON_OPEN_WITH_DATA",
  "TABLE_EMPTY_INCONCLUSIVE",
  "PROBE_ERROR",
]);

const missingFromAudit = [];
const missingVerdict = [];
const invalidVerdict = [];
for (const table of pt06Tables) {
  const entry = tables[table];
  if (!entry) {
    missingFromAudit.push(table);
    continue;
  }
  if (typeof entry.verdict !== "string" || entry.verdict.trim().length === 0) {
    missingVerdict.push(table);
    continue;
  }
  if (!VALID_TABLE_VERDICTS.has(entry.verdict)) {
    invalidVerdict.push(`${table}=${entry.verdict}`);
  }
}
if (missingFromAudit.length > 0) {
  fail(`${missingFromAudit.length} of ${pt06Tables.length} PT-06 tables have NO entry at all in rls-anon-audit.json: ${missingFromAudit.slice(0, 20).join(", ")}${missingFromAudit.length > 20 ? " ..." : ""}`);
}
if (missingVerdict.length > 0) {
  fail(`${missingVerdict.length} table(s) have an entry but no valid \`verdict\` field: ${missingVerdict.slice(0, 20).join(", ")}`);
}
if (invalidVerdict.length > 0) {
  fail(`${invalidVerdict.length} table(s) have a \`verdict\` outside the known set: ${invalidVerdict.slice(0, 20).join(", ")}`);
}

// Every table's verdict must be backed by a real anon HTTP probe result
// (not just a static/inferred classification) -- confirm the probe object
// carries either a real http_status or a transport_error, and (for the
// PROBE_ERROR / TABLE_EMPTY_INCONCLUSIVE cases) a db_level_fallback_verdict
// so an inconclusive-from-data table still resolves to something real.
let missingLiveProbe = 0;
let emptyTablesMissingFallback = 0;
for (const table of pt06Tables) {
  const entry = tables[table];
  const probe = entry.anon_http_probe;
  const hasRealProbe = probe && (typeof probe.http_status === "number" || typeof probe.transport_error === "string");
  if (!hasRealProbe) missingLiveProbe++;
  if (entry.verdict === "TABLE_EMPTY_INCONCLUSIVE" && (typeof entry.db_level_fallback_verdict !== "string" || entry.db_level_fallback_verdict.trim().length === 0)) {
    emptyTablesMissingFallback++;
  }
}
if (missingLiveProbe > 0) {
  fail(`${missingLiveProbe} table(s) have a verdict with no backing live anon HTTP probe result (no http_status or transport_error recorded) -- a verdict must come from a real attempt, not an assumption.`);
}
if (emptyTablesMissingFallback > 0) {
  fail(`${emptyTablesMissingFallback} table(s) marked TABLE_EMPTY_INCONCLUSIVE have no db_level_fallback_verdict -- an empty-today table must still resolve to a real DB-level grant/RLS verdict, not be left open.`);
}

// Any table this file itself flags as a P0 finding must carry a
// non-trivial explanation (severity + verdict alone isn't a usable
// finding without the row counts that justify it).
let p0MissingEvidence = 0;
const p0Tables = pt06Tables.filter((t) => tables[t].severity === "P0");
for (const t of p0Tables) {
  const entry = tables[t];
  if (typeof entry.anon_http_probe?.row_count_returned !== "number" || entry.anon_http_probe.row_count_returned <= 0) {
    p0MissingEvidence++;
  }
}
if (p0MissingEvidence > 0) {
  fail(`${p0MissingEvidence} table(s) marked severity P0 do not carry a real anon_http_probe.row_count_returned > 0 to justify it.`);
}

// ---- Requirement 2: every storage bucket has a policy verdict ----
const bucketNames = Object.keys(buckets);
if (bucketNames.length === 0) {
  fail("rls-anon-audit.json's `buckets` object is empty -- storage.buckets must have been queried live and produced at least one bucket.");
}
const VALID_BUCKET_POLICY_VERDICTS = new Set([
  "PUBLIC_BUCKET_WORLD_READABLE_BY_DESIGN",
  "ZERO_POLICY_DEFAULT_DENY",
  "POLICY_APPLIES_TO_ANON_OR_PUBLIC",
  "POLICY_EXISTS_AUTHENTICATED_OR_SCOPED_ONLY",
]);
const VALID_BUCKET_EXPOSURE_VERDICTS = new Set([
  "OPEN_PUBLIC_BY_DESIGN",
  "ANON_OPEN",
  "NO_OBJECTS_TO_TEST",
  "ANON_BLOCKED",
]);
const bucketsMissingPolicyVerdict = [];
const bucketsInvalidPolicyVerdict = [];
const bucketsMissingExposureVerdict = [];
for (const bucket of bucketNames) {
  const entry = buckets[bucket];
  if (typeof entry.db_policy_verdict !== "string" || entry.db_policy_verdict.trim().length === 0) {
    bucketsMissingPolicyVerdict.push(bucket);
    continue;
  }
  if (!VALID_BUCKET_POLICY_VERDICTS.has(entry.db_policy_verdict)) {
    bucketsInvalidPolicyVerdict.push(`${bucket}=${entry.db_policy_verdict}`);
  }
  if (typeof entry.live_exposure_verdict !== "string" || !VALID_BUCKET_EXPOSURE_VERDICTS.has(entry.live_exposure_verdict)) {
    bucketsMissingExposureVerdict.push(bucket);
  }
}
if (bucketsMissingPolicyVerdict.length > 0) {
  fail(`${bucketsMissingPolicyVerdict.length} bucket(s) have no \`db_policy_verdict\`: ${bucketsMissingPolicyVerdict.join(", ")}`);
}
if (bucketsInvalidPolicyVerdict.length > 0) {
  fail(`${bucketsInvalidPolicyVerdict.length} bucket(s) have a \`db_policy_verdict\` outside the known set: ${bucketsInvalidPolicyVerdict.join(", ")}`);
}
if (bucketsMissingExposureVerdict.length > 0) {
  fail(`${bucketsMissingExposureVerdict.length} bucket(s) have no valid \`live_exposure_verdict\` (a real anon LIST/GET attempt result): ${bucketsMissingExposureVerdict.join(", ")}`);
}

// Every bucket must carry a real live anon_list probe result too (a policy
// verdict alone, without an actual attempt, would not satisfy "attempt a
// read with the ANON key").
let bucketsMissingLiveProbe = 0;
for (const bucket of bucketNames) {
  const entry = buckets[bucket];
  const probe = entry.anon_list;
  const hasReal = probe && (typeof probe.http_status === "number" || typeof probe.transport_error === "string");
  if (!hasReal) bucketsMissingLiveProbe++;
}
if (bucketsMissingLiveProbe > 0) {
  fail(`${bucketsMissingLiveProbe} bucket(s) have no real anon_list HTTP probe result recorded.`);
}

// ---- Requirement 3 (completeness, per task step 3): RPC surface enumerated ----
if (!Array.isArray(rpcs) || rpcs.length === 0) {
  fail("rls-anon-audit.json's `rpcs` array is missing or empty -- the RPC surface must be enumerated.");
}
const rpcsMissingFields = rpcs.filter((r) => typeof r.name !== "string" || typeof r.anon_can_execute !== "boolean" || typeof r.security_definer !== "boolean");
if (rpcsMissingFields.length > 0) {
  fail(`${rpcsMissingFields.length} RPC entries are missing name/anon_can_execute/security_definer fields.`);
}

// ---- Requirement 4: every disputed MASTER_BACKLOG item is explicitly resolved ----
if (!Array.isArray(disputes) || disputes.length === 0) {
  fail("rls-anon-audit.json's `disputed_items_resolution` array is missing or empty -- the task requires explicitly resolving each previously-disputed item.");
}
let disputesMissingResolution = 0;
for (const d of disputes) {
  if (typeof d.resolvedAs !== "string" || d.resolvedAs.trim().length === 0) disputesMissingResolution++;
}
if (disputesMissingResolution > 0) {
  fail(`${disputesMissingResolution} disputed item(s) have no \`resolvedAs\` verdict.`);
}
// All 8 of MASTER_BACKLOG §1.1's named anon-exposed tables must be present
// among the disputed items -- this is the specific conflict the task named.
const MASTER_BACKLOG_TIER_1_1_TABLES = [
  "platform_admins",
  "organizational_digital_twins",
  "opportunity_probability_scores",
  "donor_discovery_directory",
  "autoapply_submissions",
  "submission_queue",
  "form_templates",
  "request_profiles",
];
const disputedTableNames = new Set(disputes.map((d) => d.table).filter(Boolean));
const missingTier11 = MASTER_BACKLOG_TIER_1_1_TABLES.filter((t) => !disputedTableNames.has(t));
if (missingTier11.length > 0) {
  fail(`MASTER_BACKLOG.md §1.1 named these anon-exposed tables, but they are not present in disputed_items_resolution: ${missingTier11.join(", ")}`);
}

// ---- Requirement 5: summary counts match the raw data (no drift) ----
if (summary.tables_total !== pt06Tables.length) {
  fail(`summary.tables_total (${summary.tables_total}) does not match PT-06's real table count (${pt06Tables.length}).`);
}
const recomputedTablesTotal = Object.keys(tables).length;
if (recomputedTablesTotal !== pt06Tables.length) {
  fail(`rls-anon-audit.json's tables object has ${recomputedTablesTotal} entries, but PT-06's schema has ${pt06Tables.length} -- these must match exactly (no extras, no gaps).`);
}
if (summary.buckets_total !== bucketNames.length) {
  fail(`summary.buckets_total (${summary.buckets_total}) does not match the real bucket count in this file (${bucketNames.length}).`);
}

console.log("PASS: rls-anon-audit.json records a real anon-access verdict for every one of PT-06's " + pt06Tables.length + " tables, and a real policy verdict for every one of " + bucketNames.length + " storage buckets.");
console.log(`  Tables by verdict: ${JSON.stringify(summary.tables_by_verdict ?? {})}`);
console.log(`  Table P0 findings: ${summary.tables_p0_findings ?? 0}`);
console.log(`  Buckets by exposure verdict: ${JSON.stringify(summary.buckets_by_verdict ?? {})}`);
console.log(`  Bucket P0 findings: ${summary.buckets_p0_findings ?? 0}`);
console.log(`  RPCs enumerated: ${rpcs.length} (${summary.rpcs_anon_executable ?? "?"} anon-executable)`);
console.log(`  Disputed MASTER_BACKLOG items resolved: ${disputes.length} (${summary.disputed_items_still_open ?? 0} still open, ${summary.disputed_items_confirmed_fixed ?? 0} confirmed fixed)`);
process.exit(0);
