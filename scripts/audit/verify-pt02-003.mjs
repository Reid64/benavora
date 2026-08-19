// PT-02-003 verifier: confirms role-matrix.json is non-empty, covers every admin- or
// owner-gated route from the PT-02-001 API-route working set (api-routes.json) -- proves
// nothing was dropped from the matrix -- and that every row carries a recognized, non-empty
// verdict. Also sanity-checks the role/tier coverage per route (every row's role_tested is
// one of the app's 4 real roles, and every covered route was actually exercised across all
// 4 roles, not a partial sample) and that any under-enforcement finding row captured its
// full response body, matching this task's own evidence requirement. Exits 0 only if all
// checks pass; exits 1 with a printed reason on any failure.
// ASCII only. Node 20 compatible.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const apiRoutesPath = path.join(repoRoot, "test-evidence", "pt-02", "api-routes.json");
const matrixPath = path.join(repoRoot, "test-evidence", "pt-02", "role-matrix.json");

const VALID_VERDICTS = new Set(["PASS", "FINDING_P0", "FINDING_P1", "FINDING_OVER_RESTRICTIVE", "REVIEW"]);
const VALID_ROLES = new Set(["viewer", "writer", "admin", "owner"]);

function fail(reason) {
  console.error(`PT-02-003 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  // 1. api-routes.json (the PT-02-001 working set this matrix must cover) must exist and parse.
  let apiRoutesFile;
  try {
    apiRoutesFile = assertJsonFileHasKey(apiRoutesPath, "apiRoutes");
  } catch (err) {
    fail(`api-routes.json check failed: ${err.message}`);
    return;
  }
  if (!Array.isArray(apiRoutesFile.apiRoutes)) {
    fail(`apiRoutes[] is not an array in ${apiRoutesPath}`);
    return;
  }

  // The admin/owner-gated working set: every route whose requireRole classification
  // includes "admin" or "owner" anywhere in its file-level tier set (matches how
  // pt02-001 itself classifies -- a route with e.g. a viewer-tier GET and an
  // owner-tier POST in the same file is still "admin/owner-gated" for this scope).
  const expectedRoutes = apiRoutesFile.apiRoutes.filter(
    (r) => r && r.auth && r.auth.mechanism === "requireRole" &&
      Array.isArray(r.auth.tiers) && r.auth.tiers.some((t) => t === "admin" || t === "owner"),
  );
  const expectedPaths = new Set(expectedRoutes.map((r) => r.path));
  if (expectedPaths.size === 0) {
    fail(`no admin/owner-gated routes found in api-routes.json -- cannot verify a non-empty scope`);
    return;
  }

  // 2. role-matrix.json must exist, be non-empty, and parse with a results[] array.
  let matrixFile;
  try {
    matrixFile = assertJsonFileHasKey(matrixPath, "results");
  } catch (err) {
    fail(`role-matrix.json check failed: ${err.message}`);
    return;
  }
  if (!Array.isArray(matrixFile.results) || matrixFile.results.length === 0) {
    fail(`results[] in role-matrix.json is missing, not an array, or empty`);
    return;
  }

  // 3. Every admin/owner-gated route from api-routes.json must appear at least once
  //    (path-set coverage -- a route with zero rows means it was silently dropped).
  const coveredPaths = new Set(matrixFile.results.map((r) => r && r.path));
  const missingRoutes = [...expectedPaths].filter((p) => !coveredPaths.has(p));
  if (missingRoutes.length > 0) {
    fail(
      `${missingRoutes.length} admin/owner-gated route(s) from api-routes.json have no row ` +
        `in role-matrix.json: ${missingRoutes.slice(0, 10).join(", ")}${missingRoutes.length > 10 ? ", ..." : ""}`,
    );
    return;
  }

  // 4. Every row must carry a real, non-empty, recognized verdict.
  const badVerdict = matrixFile.results.filter((r) => {
    if (!r || typeof r.verdict !== "string" || r.verdict.trim().length === 0) return true;
    return !VALID_VERDICTS.has(r.verdict);
  });
  if (badVerdict.length > 0) {
    fail(
      `${badVerdict.length} row(s) have a missing, empty, or unrecognized verdict: ` +
        `${badVerdict.slice(0, 10).map((r) => `${r && r.path}/${r && r.method}/${r && r.role_tested} (verdict=${r && r.verdict})`).join(", ")}` +
        (badVerdict.length > 10 ? ", ..." : ""),
    );
    return;
  }

  // 5. Every row must carry a role_tested that is one of this app's 4 real roles, a
  //    required_tier of admin or owner (this matrix's own stated scope), and a recorded
  //    outcome (a numeric status or an explicit error string).
  const badRole = matrixFile.results.filter((r) => !r || !VALID_ROLES.has(r.role_tested));
  if (badRole.length > 0) {
    fail(
      `${badRole.length} row(s) have a role_tested outside {viewer,writer,admin,owner}: ` +
        `${badRole.slice(0, 10).map((r) => `${r && r.path} (role_tested=${r && r.role_tested})`).join(", ")}`,
    );
    return;
  }
  const badTier = matrixFile.results.filter((r) => r.required_tier !== "admin" && r.required_tier !== "owner");
  if (badTier.length > 0) {
    fail(
      `${badTier.length} row(s) have a required_tier outside {admin,owner} -- outside this ` +
        `matrix's stated admin/owner-gated scope: ${badTier.slice(0, 10).map((r) => `${r.path} (required_tier=${r.required_tier})`).join(", ")}`,
    );
    return;
  }
  const noOutcome = matrixFile.results.filter((r) => {
    const hasStatus = typeof r.status === "number";
    const hasError = typeof r.error === "string" && r.error.length > 0;
    return !hasStatus && !hasError;
  });
  if (noOutcome.length > 0) {
    fail(
      `${noOutcome.length} row(s) have neither a numeric status nor an error string -- the ` +
        `request outcome was never recorded: ${noOutcome.slice(0, 10).map((r) => `${r.path}/${r.role_tested}`).join(", ")}`,
    );
    return;
  }

  // 6. Every covered route was tested across all 4 roles, per route+method combination --
  //    a route present but only tested at e.g. 1 of 4 roles would silently under-cover the
  //    "record whether it refuses below-tier roles and permits at/above" requirement.
  const byRouteMethod = new Map();
  for (const r of matrixFile.results) {
    const key = `${r.path}::${r.method}`;
    if (!byRouteMethod.has(key)) byRouteMethod.set(key, new Set());
    byRouteMethod.get(key).add(r.role_tested);
  }
  const partialCoverage = [...byRouteMethod.entries()].filter(([, roles]) => roles.size !== 4);
  if (partialCoverage.length > 0) {
    fail(
      `${partialCoverage.length} route+method combination(s) were not tested across all 4 roles: ` +
        `${partialCoverage.slice(0, 10).map(([k, roles]) => `${k} (tested: ${[...roles].join(",")})`).join(", ")}`,
    );
    return;
  }

  // 7. Any under-enforcement finding row (P0/P1) must carry its captured response, per this
  //    task's own evidence requirement.
  const uncapturedFindings = matrixFile.results.filter(
    (r) => (r.verdict === "FINDING_P0" || r.verdict === "FINDING_P1") && typeof r.bodySnippet !== "string",
  );
  if (uncapturedFindings.length > 0) {
    fail(
      `${uncapturedFindings.length} under-enforcement finding row(s) have no captured bodySnippet: ` +
        `${uncapturedFindings.map((r) => `${r.path}/${r.method}/${r.role_tested}`).join(", ")}`,
    );
    return;
  }

  const verdictCounts = {};
  for (const r of matrixFile.results) verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
  const p0Count = verdictCounts["FINDING_P0"] || 0;
  const p1Count = verdictCounts["FINDING_P1"] || 0;

  console.log(
    `PT-02-003 PASS: role-matrix.json covers all ${expectedPaths.size} admin/owner-gated route(s) ` +
      `from api-routes.json across all 4 real roles (viewer/writer/admin/owner), ${matrixFile.results.length} ` +
      `total row(s). Every row has a recognized verdict and a recorded outcome. Verdict counts: ` +
      `${JSON.stringify(verdictCounts)}.` +
      (p0Count > 0 || p1Count > 0
        ? ` *** ${p0Count} P0 + ${p1Count} P1 UNDER-ENFORCEMENT FINDING(S) PRESENT -- see role-matrix.json results[] where verdict starts with "FINDING_" ***`
        : " No under-enforcement findings."),
  );
  process.exit(0);
}

main();
