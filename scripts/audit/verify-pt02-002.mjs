// PT-02-002 verifier: confirms the unauthenticated-rejection sweep actually covers every
// route in the PT-02-001 API-route working set (api-routes.json) -- proves nothing was
// dropped from the sweep -- and that every row carries a real verdict (never left null/
// undefined/empty). Also sanity-checks that any P0 auth-bypass finding row captured its
// full response, per this task's own evidence requirement. Exits 0 only if all checks
// pass; exits 1 with a printed reason on any failure.
// ASCII only. Node 20 compatible.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const apiRoutesPath = path.join(repoRoot, "test-evidence", "pt-02", "api-routes.json");
const sweepPath = path.join(repoRoot, "test-evidence", "pt-02", "unauth-sweep.json");

const VALID_VERDICTS = new Set(["PASS", "PASS_DESIGN_MISMATCH", "FINDING_P0_AUTH_BYPASS", "REVIEW"]);

function fail(reason) {
  console.error(`PT-02-002 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  // 1. api-routes.json (the PT-02-001 working set this sweep must cover) must exist and parse.
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
  const expectedPaths = new Set(apiRoutesFile.apiRoutes.map((r) => r && r.path));
  if (expectedPaths.size !== apiRoutesFile.apiRoutes.length) {
    fail(`api-routes.json itself has duplicate path entries -- cannot verify coverage against it`);
    return;
  }

  // 2. unauth-sweep.json must exist and parse, with a results[] array.
  let sweepFile;
  try {
    sweepFile = assertJsonFileHasKey(sweepPath, "results");
  } catch (err) {
    fail(`unauth-sweep.json check failed: ${err.message}`);
    return;
  }
  if (!Array.isArray(sweepFile.results)) {
    fail(`results[] is not an array in ${sweepPath}`);
    return;
  }

  // 3. Count match -- the core proof nothing was dropped from the sweep.
  if (sweepFile.results.length !== apiRoutesFile.apiRoutes.length) {
    fail(
      `unauth-sweep.json has ${sweepFile.results.length} row(s), but api-routes.json has ` +
        `${apiRoutesFile.apiRoutes.length} route(s) -- counts do not match`
    );
    return;
  }

  // 4. Every route path in api-routes.json must have exactly one corresponding sweep row --
  //    a plain count match alone could hide a duplicate-plus-omission pair, so check the
  //    actual path set, not just the length.
  const sweptPaths = sweepFile.results.map((r) => r && r.path);
  const sweptPathCounts = new Map();
  for (const p of sweptPaths) {
    sweptPathCounts.set(p, (sweptPathCounts.get(p) || 0) + 1);
  }
  const missing = [...expectedPaths].filter((p) => !sweptPathCounts.has(p));
  const duplicated = [...sweptPathCounts.entries()].filter(([, count]) => count > 1);
  if (missing.length > 0) {
    fail(
      `${missing.length} route(s) from api-routes.json have no row in unauth-sweep.json: ` +
        `${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", ..." : ""}`
    );
    return;
  }
  if (duplicated.length > 0) {
    fail(
      `${duplicated.length} path(s) appear more than once in unauth-sweep.json results[]: ` +
        `${duplicated.slice(0, 10).map(([p, c]) => `${p} (x${c})`).join(", ")}`
    );
    return;
  }
  const extra = sweptPaths.filter((p) => !expectedPaths.has(p));
  if (extra.length > 0) {
    fail(
      `unauth-sweep.json contains ${extra.length} row(s) for a path not present in ` +
        `api-routes.json: ${extra.slice(0, 10).join(", ")}${extra.length > 10 ? ", ..." : ""}`
    );
    return;
  }

  // 5. Every row must carry a real, non-empty, recognized verdict -- never left null/undefined/"".
  const badVerdict = sweepFile.results.filter((r) => {
    if (!r || typeof r.verdict !== "string" || r.verdict.trim().length === 0) return true;
    return !VALID_VERDICTS.has(r.verdict);
  });
  if (badVerdict.length > 0) {
    fail(
      `${badVerdict.length} row(s) have a missing, empty, or unrecognized verdict: ` +
        `${badVerdict.slice(0, 10).map((r) => `${r && r.path} (verdict=${r && r.verdict})`).join(", ")}` +
        (badVerdict.length > 10 ? ", ..." : "")
    );
    return;
  }

  // 6. Every row must carry a recorded status (a number) or an explicit error string --
  //    a row with neither means the request outcome was never actually observed.
  const noOutcome = sweepFile.results.filter((r) => {
    const hasStatus = typeof r.status === "number";
    const hasError = typeof r.error === "string" && r.error.length > 0;
    return !hasStatus && !hasError;
  });
  if (noOutcome.length > 0) {
    fail(
      `${noOutcome.length} row(s) have neither a numeric status nor an error string -- the ` +
        `request outcome was never recorded: ${noOutcome.slice(0, 10).map((r) => r.path).join(", ")}`
    );
    return;
  }

  // 7. Per this task's own evidence requirement ("Capture any auth-bypass finding's full
  //    response"), any row verdicted as a P0 bypass must actually carry a captured body.
  const uncapturedFindings = sweepFile.results.filter(
    (r) => r.verdict === "FINDING_P0_AUTH_BYPASS" && typeof r.bodySnippet !== "string"
  );
  if (uncapturedFindings.length > 0) {
    fail(
      `${uncapturedFindings.length} FINDING_P0_AUTH_BYPASS row(s) have no captured bodySnippet: ` +
        `${uncapturedFindings.map((r) => r.path).join(", ")}`
    );
    return;
  }

  const verdictCounts = {};
  for (const r of sweepFile.results) {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
  }
  const p0Count = verdictCounts["FINDING_P0_AUTH_BYPASS"] || 0;

  console.log(
    `PT-02-002 PASS: unauth-sweep.json covers all ${sweepFile.results.length} route(s) from ` +
      `api-routes.json (exact path-set match, no duplicates, no omissions). Every row has a ` +
      `recognized verdict and a recorded outcome. Verdict counts: ${JSON.stringify(verdictCounts)}.` +
      (p0Count > 0
        ? ` *** ${p0Count} P0 AUTH-BYPASS FINDING(S) PRESENT -- see unauth-sweep.json results[] where verdict == "FINDING_P0_AUTH_BYPASS" ***`
        : " No P0 auth-bypass findings.")
  );
  process.exit(0);
}

main();
