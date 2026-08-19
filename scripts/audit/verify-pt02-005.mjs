// PT-02-005 verifier: confirms test-evidence/pt-02/pagination-and-500s.json records (1) a
// pagination verdict for every large-table list endpoint this task's own scope named
// (foundation_directory, donor_discovery_directory, nonprofit tables, prospects), and (2) a real,
// non-empty root cause for each of the 5 known 500s (WGR-005 through WGR-009). Exits 0 only if
// all checks pass; exits 1 with a printed reason on any failure.
// ASCII only. Node 20 compatible.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const evidencePath = path.join(repoRoot, "test-evidence", "pt-02", "pagination-and-500s.json");

// The endpoints this task's own scope requires a verdict for -- one per large table family named
// in the task (foundation_directory, donor_discovery_directory, nonprofit tables, prospects),
// covering every real list-returning surface found for each via a repo-wide grep.
const EXPECTED_ENDPOINTS = new Set([
  "/foundations (page, client-side query)", // foundation_directory
  "/nonprofits (page, client-side query)", // nonprofit tables
  "GET /api/intelligence/corporate-prospects", // prospects
  "GET /api/donor-discovery/prospects (main listing path, no taxonomy_id/request_id filter)", // prospects
  "GET /api/intelligence/outreach/prospects", // prospects
  "GET /api/donor-discovery/requests/[id]", // prospects
  "GET /api/donor-discovery/pipeline", // prospects
  "GET /api/intelligence/proposals", // large table (intelligence_funded_proposals), found during audit
  "GET /api/donor-discovery/prospects?taxonomy_id=... and ?request_id=...", // donor_discovery_directory + prospects
]);

const VALID_VERDICTS = new Set([
  "PAGINATES_CORRECTLY",
  "BOUNDED_NO_TOTAL",
  "SILENT_TRUNCATION_CONFIRMED",
  "SILENT_TRUNCATION_LATENT",
  "MIXED (request_id branch: SILENT_TRUNCATION_CONFIRMED, same mechanism as WGR-029; taxonomy_id branch: SILENT_TRUNCATION_LATENT)",
]);

const EXPECTED_500_WGR_IDS = ["WGR-005", "WGR-006", "WGR-007", "WGR-008", "WGR-009"];

function fail(reason) {
  console.error(`PT-02-005 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  let doc;
  try {
    doc = assertJsonFileHasKey(evidencePath, "paginationAudit");
  } catch (err) {
    fail(`pagination-and-500s.json check failed: ${err.message}`);
    return;
  }

  if (!("known500s" in doc)) {
    fail(`pagination-and-500s.json has no top-level "known500s" key`);
    return;
  }

  // --- Part 1: pagination verdicts ---

  const endpoints = doc.paginationAudit && doc.paginationAudit.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    fail(`paginationAudit.endpoints is missing, not an array, or empty`);
    return;
  }

  const presentEndpoints = new Set(endpoints.map((e) => e && e.endpoint));
  const missingEndpoints = [...EXPECTED_ENDPOINTS].filter((e) => !presentEndpoints.has(e));
  if (missingEndpoints.length > 0) {
    fail(
      `${missingEndpoints.length} expected large-table list endpoint(s) have no row in ` +
        `paginationAudit.endpoints: ${missingEndpoints.join(" | ")}`,
    );
    return;
  }

  for (const e of endpoints) {
    if (!e || typeof e.endpoint !== "string" || e.endpoint.trim() === "") {
      fail(`a paginationAudit.endpoints row is missing "endpoint": ${JSON.stringify(e).slice(0, 200)}`);
      return;
    }
    if (typeof e.table !== "string" || e.table.trim() === "") {
      fail(`endpoint "${e.endpoint}" has no "table"`);
      return;
    }
    if (typeof e.file !== "string" || e.file.trim() === "") {
      fail(`endpoint "${e.endpoint}" has no "file"`);
      return;
    }
    if (typeof e.verdict !== "string" || !VALID_VERDICTS.has(e.verdict)) {
      fail(`endpoint "${e.endpoint}" has no recognized "verdict": ${JSON.stringify(e.verdict)}`);
      return;
    }
    if (typeof e.detail !== "string" || e.detail.trim().length < 20) {
      fail(`endpoint "${e.endpoint}" has no substantive "detail" explaining the verdict`);
      return;
    }
    if (typeof e.liveRowCount !== "number") {
      fail(`endpoint "${e.endpoint}" has no numeric "liveRowCount" (actual returned row count vs table total requires a real captured total)`);
      return;
    }
    const isTruncationFinding =
      e.verdict === "SILENT_TRUNCATION_CONFIRMED" ||
      e.verdict === "SILENT_TRUNCATION_LATENT" ||
      e.verdict.startsWith("MIXED");
    if (isTruncationFinding && (typeof e.wgrId !== "string" || e.wgrId.trim() === "")) {
      fail(`endpoint "${e.endpoint}" is a truncation finding but has no "wgrId" pointing at its register row`);
      return;
    }
  }

  // --- Part 2: the 5 known 500s ---

  const findings = doc.known500s && doc.known500s.findings;
  if (!Array.isArray(findings) || findings.length === 0) {
    fail(`known500s.findings is missing, not an array, or empty`);
    return;
  }

  const presentWgrIds = new Set(findings.map((f) => f && f.wgrId));
  const missingWgrIds = EXPECTED_500_WGR_IDS.filter((id) => !presentWgrIds.has(id));
  if (missingWgrIds.length > 0) {
    fail(`known500s.findings is missing entries for: ${missingWgrIds.join(", ")}`);
    return;
  }

  for (const f of findings) {
    if (!f || typeof f.wgrId !== "string" || !EXPECTED_500_WGR_IDS.includes(f.wgrId)) {
      fail(`a known500s.findings row has an unrecognized or missing "wgrId": ${JSON.stringify(f && f.wgrId)}`);
      return;
    }
    if (typeof f.endpoint !== "string" || f.endpoint.trim() === "") {
      fail(`${f.wgrId} has no "endpoint"`);
      return;
    }
    if (typeof f.handlerFile !== "string" || f.handlerFile.trim() === "") {
      fail(`${f.wgrId} has no "handlerFile"`);
      return;
    }
    if (typeof f.rootCauseCategory !== "string" || f.rootCauseCategory.trim() === "") {
      fail(`${f.wgrId} has no "rootCauseCategory"`);
      return;
    }
    // The real requirement: a root cause must actually be recorded, not just a placeholder ---
    // "root cause: X" per the task's own wording -- so require real substance, not a stub string.
    if (typeof f.rootCause !== "string" || f.rootCause.trim().length < 60) {
      fail(`${f.wgrId} has no substantive "rootCause" (must be a real, specific explanation, not a stub)`);
      return;
    }
    if (!f.liveEvidence || typeof f.liveEvidence !== "object") {
      fail(`${f.wgrId} has no "liveEvidence" object backing its root cause`);
      return;
    }
  }

  // WGR-007 carries a known, still-owed product decision -- confirm this task recorded that it
  // re-checked (not silently dropped) that decision, per the task's explicit instruction.
  const wgr007 = findings.find((f) => f.wgrId === "WGR-007");
  if (!wgr007 || typeof wgr007.pendingProductDecision !== "string" || wgr007.pendingProductDecision.trim() === "") {
    fail(`WGR-007 has no "pendingProductDecision" field -- the task explicitly requires confirming this decision is still owed, not silently resolving or dropping it`);
    return;
  }

  const truncationCount = endpoints.filter(
    (e) =>
      e.verdict === "SILENT_TRUNCATION_CONFIRMED" ||
      e.verdict === "SILENT_TRUNCATION_LATENT" ||
      e.verdict.startsWith("MIXED"),
  ).length;
  const okCount = endpoints.length - truncationCount;

  console.log(
    `PT-02-005 PASS: pagination-and-500s.json covers all ${EXPECTED_ENDPOINTS.size} expected ` +
      `large-table list endpoint(s) (${okCount} paginate correctly or are honestly bounded, ` +
      `${truncationCount} show silent truncation -- confirmed or latent), and all 5 known 500s ` +
      `(WGR-005..009) carry a substantive, evidence-backed root cause. WGR-007's pending product ` +
      `decision is confirmed still owed, not silently resolved.`,
  );
  process.exit(0);
}

main();
