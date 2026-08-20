// PT-10-001 verifier: confirms test-evidence/pt-10/malformed-payloads.json records a real,
// representative set of API input surfaces (cross-checked against PT-02's own api-routes.json
// working set, so a route can't be silently invented) and that every case carries a captured
// request + response and a recognized, non-empty verdict -- proving the malformed-payload fuzz
// actually ran end-to-end rather than being partially written or silently dropping cases.
// Also re-derives verdictCounts/findingCount from the cases[] array itself and fails if the
// document's own summary fields have drifted from what the cases actually say, and fails if
// the recorded baseUrl/targetSupabaseUrl look like a production Benavora target (this task's
// own hard local/branch-only rule, matched against BRANCH_STRATEGY.md).
// Exits 0 only if all checks pass; exits 1 with a printed reason on any failure.
// ASCII only. Node 20 compatible.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const evidencePath = path.join(repoRoot, "test-evidence", "pt-10", "malformed-payloads.json");
const apiRoutesPath = path.join(repoRoot, "test-evidence", "pt-02", "api-routes.json");

const VALID_VERDICTS = new Set(["PASS", "PASS_WEAK_ERROR", "FINDING", "ACCEPTED_NO_VALIDATION"]);
const VALID_CATEGORIES = new Set([
  "missing_required",
  "wrong_type",
  "oversized",
  "injection_shaped",
  "invalid_json",
  "non_object_body",
]);
const PROD_URL_FRAGMENT = "vbjplpquqxxfbpazyalt";

const MIN_CASE_COUNT = 20;
const MIN_ROUTE_COUNT = 10;
const MIN_CATEGORY_COVERAGE = 4;

function fail(reason) {
  console.error(`PT-10-001 FAIL: ${reason}`);
  process.exit(1);
}

function routeTemplateToRegex(routePath) {
  // api-routes.json paths use Next.js's own [param] / [taskId] segment names, which vary
  // per route -- turn each bracketed segment into a wildcard so any real substituted id
  // matches, regardless of what the dynamic segment happens to be called.
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\\\[[^\]]+\\\]/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

function findMatchingKnownPath(casePath, knownPaths) {
  for (const known of knownPaths) {
    if (typeof known === "string" && routeTemplateToRegex(known).test(casePath)) return known;
  }
  return null;
}

function main() {
  // 1. malformed-payloads.json must exist, be non-empty, parse, and carry a non-empty cases[].
  let evidence;
  try {
    evidence = assertJsonFileHasKey(evidencePath, "cases");
  } catch (err) {
    fail(`malformed-payloads.json check failed: ${err.message}`);
    return;
  }
  if (!Array.isArray(evidence.cases) || evidence.cases.length === 0) {
    fail(`cases[] in malformed-payloads.json is missing, not an array, or empty`);
    return;
  }
  if (evidence.cases.length < MIN_CASE_COUNT) {
    fail(
      `only ${evidence.cases.length} case(s) recorded -- below the minimum of ${MIN_CASE_COUNT} ` +
        `expected for a representative surface set`,
    );
    return;
  }

  // 2. Never a production target -- this task's own hard local/branch-only rule.
  if (typeof evidence.baseUrl === "string" && evidence.baseUrl.includes(PROD_URL_FRAGMENT)) {
    fail(`baseUrl looks like production (${evidence.baseUrl})`);
    return;
  }
  if (
    typeof evidence.targetSupabaseUrl === "string" &&
    evidence.targetSupabaseUrl.includes(PROD_URL_FRAGMENT)
  ) {
    fail(`targetSupabaseUrl looks like production (${evidence.targetSupabaseUrl})`);
    return;
  }

  // 3. Cross-check every case's route against PT-02's own real api-routes.json working set --
  //    a fabricated or typo'd route would silently pass every other check below.
  let apiRoutesFile;
  try {
    apiRoutesFile = assertJsonFileHasKey(apiRoutesPath, "apiRoutes");
  } catch (err) {
    fail(`api-routes.json check failed: ${err.message}`);
    return;
  }
  const knownPaths = (apiRoutesFile.apiRoutes || []).map((r) => r && r.path).filter(Boolean);
  const matchedTemplateByCase = new Map();
  const unknownRoutes = evidence.cases.filter((c) => {
    const p = c && c.route && c.route.path;
    if (typeof p !== "string") return true;
    const match = findMatchingKnownPath(p, knownPaths);
    if (match) matchedTemplateByCase.set(c, match);
    return !match;
  });
  if (unknownRoutes.length > 0) {
    fail(
      `${unknownRoutes.length} case(s) reference a route not present in PT-02's api-routes.json: ` +
        `${unknownRoutes.slice(0, 10).map((c) => `${c.id || "?"}:${c.route && c.route.path}`).join(", ")}`,
    );
    return;
  }

  // 4. Representative surface coverage -- must span a real spread of distinct routes, not one
  //    route hammered repeatedly with cosmetic variants.
  const routeSet = new Set(
    evidence.cases.map((c) => `${c.route && c.route.method} ${matchedTemplateByCase.get(c) || (c.route && c.route.path)}`),
  );
  if (routeSet.size < MIN_ROUTE_COUNT) {
    fail(
      `only ${routeSet.size} distinct route(s) covered -- below the minimum of ${MIN_ROUTE_COUNT} ` +
        `expected for a representative surface set`,
    );
    return;
  }

  // 5. Every case must carry a captured request and response (or an explicit network error),
  //    a recognized category, and a recognized, non-empty verdict.
  const badRequest = evidence.cases.filter(
    (c) => !c.request || typeof c.request.bodyKind !== "string" || typeof c.request.path !== "string",
  );
  if (badRequest.length > 0) {
    fail(
      `${badRequest.length} case(s) have no captured request: ` +
        `${badRequest.slice(0, 10).map((c) => c.id || "?").join(", ")}`,
    );
    return;
  }
  const badResponse = evidence.cases.filter((c) => {
    if (!c.response) return true;
    const hasStatus = typeof c.response.status === "number";
    const hasNetworkError = typeof c.response.networkError === "string" && c.response.networkError.length > 0;
    return !hasStatus && !hasNetworkError;
  });
  if (badResponse.length > 0) {
    fail(
      `${badResponse.length} case(s) have no captured response (neither a numeric status nor a ` +
        `networkError string): ${badResponse.slice(0, 10).map((c) => c.id || "?").join(", ")}`,
    );
    return;
  }
  const badCategory = evidence.cases.filter((c) => !VALID_CATEGORIES.has(c.category));
  if (badCategory.length > 0) {
    fail(
      `${badCategory.length} case(s) have a missing/unrecognized category: ` +
        `${badCategory.slice(0, 10).map((c) => `${c.id || "?"} (category=${c.category})`).join(", ")}`,
    );
    return;
  }
  const badVerdict = evidence.cases.filter((c) => !VALID_VERDICTS.has(c.verdict));
  if (badVerdict.length > 0) {
    fail(
      `${badVerdict.length} case(s) have a missing/unrecognized verdict: ` +
        `${badVerdict.slice(0, 10).map((c) => `${c.id || "?"} (verdict=${c.verdict})`).join(", ")}`,
    );
    return;
  }

  // 6. Category coverage -- the fuzz must actually exercise a spread of malformed-input shapes,
  //    not just one category repeated across every route.
  const categoriesSeen = new Set(evidence.cases.map((c) => c.category));
  if (categoriesSeen.size < MIN_CATEGORY_COVERAGE) {
    fail(
      `only ${categoriesSeen.size} distinct case categor(y/ies) covered (${[...categoriesSeen].join(", ")}) ` +
        `-- below the minimum of ${MIN_CATEGORY_COVERAGE} expected`,
    );
    return;
  }

  // 7. Any case whose verdict is FINDING must carry a verdictReason explaining why -- a bare
  //    "FINDING" with no reason would be useless to a reader triaging results.
  const findingsNoReason = evidence.cases.filter(
    (c) => c.verdict === "FINDING" && (typeof c.verdictReason !== "string" || c.verdictReason.trim().length === 0),
  );
  if (findingsNoReason.length > 0) {
    fail(
      `${findingsNoReason.length} FINDING case(s) have no verdictReason: ` +
        `${findingsNoReason.map((c) => c.id || "?").join(", ")}`,
    );
    return;
  }

  // 8. Re-derive verdictCounts/findingCount from cases[] itself and fail on drift against the
  //    document's own summary fields -- catches a hand-edited or partially-regenerated summary.
  const derivedCounts = {};
  for (const c of evidence.cases) derivedCounts[c.verdict] = (derivedCounts[c.verdict] || 0) + 1;
  const derivedFindingCount = derivedCounts["FINDING"] || 0;

  if (evidence.verdictCounts && JSON.stringify(evidence.verdictCounts) !== JSON.stringify(derivedCounts)) {
    fail(
      `verdictCounts in the document (${JSON.stringify(evidence.verdictCounts)}) does not match ` +
        `counts derived from cases[] (${JSON.stringify(derivedCounts)})`,
    );
    return;
  }
  if (typeof evidence.findingCount === "number" && evidence.findingCount !== derivedFindingCount) {
    fail(
      `findingCount in the document (${evidence.findingCount}) does not match the FINDING count ` +
        `derived from cases[] (${derivedFindingCount})`,
    );
    return;
  }

  console.log(
    `PT-10-001 PASS: malformed-payloads.json records ${evidence.cases.length} case(s) across ` +
      `${routeSet.size} distinct route(s) (all present in PT-02's api-routes.json), spanning ` +
      `${categoriesSeen.size} case categories. Every case has a captured request+response and a ` +
      `recognized verdict. Verdict counts: ${JSON.stringify(derivedCounts)}.` +
      (derivedFindingCount > 0
        ? ` *** ${derivedFindingCount} FINDING(S) PRESENT -- see malformed-payloads.json cases[] where verdict="FINDING" ***`
        : " No FINDING verdicts."),
  );
  process.exit(0);
}

main();
