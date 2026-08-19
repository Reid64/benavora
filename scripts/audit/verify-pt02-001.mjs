// PT-02-001 verifier: confirms the API-route working set was extracted and classified
// correctly from PT-00's route manifest -- proves nothing was dropped, and that every route
// carries a real methods[] array and a real auth classification (not left null/undefined).
// Exits 0 only if all checks pass; exits 1 with a printed reason on any failure.
// ASCII only. Node 20 compatible.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const manifestPath = path.join(repoRoot, "test-evidence", "pt-00", "route-manifest.json");
const apiRoutesPath = path.join(repoRoot, "test-evidence", "pt-02", "api-routes.json");

const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const VALID_MECHANISMS = new Set([
  "requireRole",
  "requireAuth",
  "checkPermission",
  "auth.getUser",
  "cron_secret",
  "webhook_signature",
  "oauth_code_exchange",
  "none_detected",
  "unreadable",
]);

function fail(reason) {
  console.error(`PT-02-001 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  // 1. PT-00 route manifest must exist and parse, with a routes[] array.
  let manifest;
  try {
    manifest = assertJsonFileHasKey(manifestPath, "routes");
  } catch (err) {
    fail(`route-manifest.json check failed: ${err.message}`);
    return;
  }
  if (!Array.isArray(manifest.routes)) {
    fail(`routes[] is not an array in ${manifestPath}`);
    return;
  }

  const expectedCount = manifest.routes.filter((r) => r && r.type === "api").length;

  // 2. api-routes.json must exist and parse, with an apiRoutes[] array.
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

  const actualCount = apiRoutesFile.apiRoutes.length;

  // 3. Declared apiRouteCount must match the actual array length.
  if (apiRoutesFile.apiRouteCount !== actualCount) {
    fail(
      `apiRouteCount field (${apiRoutesFile.apiRouteCount}) does not match ` +
        `apiRoutes[] length (${actualCount}) in ${apiRoutesPath}`
    );
    return;
  }

  // 4. Every entry in the working set must actually be type == "api".
  const nonApi = apiRoutesFile.apiRoutes.filter((r) => !r || r.type !== "api");
  if (nonApi.length > 0) {
    fail(`api-routes.json contains ${nonApi.length} entrie(s) that are not type=="api"`);
    return;
  }

  // 5. The core proof: count must match PT-00's type=="api" count exactly -- nothing dropped.
  if (actualCount !== expectedCount) {
    fail(
      `api-routes.json has ${actualCount} route(s), but PT-00 route-manifest.json has ` +
        `${expectedCount} type=="api" entries -- counts do not match, routes may have been dropped`
    );
    return;
  }

  // 6. Every route must carry a real methods[] array (non-null, an array -- may legitimately
  //    be empty only if classificationError explains why; every real route.ts in this repo
  //    exports at least one method, confirmed by a full-repo sweep before this classifier was
  //    written, so an empty methods[] with no classificationError is a real failure).
  const badMethods = apiRoutesFile.apiRoutes.filter((r) => {
    if (!Array.isArray(r.methods)) return true;
    if (r.methods.length === 0 && !r.classificationError) return true;
    return r.methods.some((m) => !VALID_METHODS.has(m));
  });
  if (badMethods.length > 0) {
    fail(
      `${badMethods.length} route(s) have a missing, empty (unexplained), or invalid methods[] ` +
        `array: ${badMethods.slice(0, 5).map((r) => r.path).join(", ")}` +
        (badMethods.length > 5 ? ", ..." : "")
    );
    return;
  }

  // 7. Every route must carry a real auth classification object with a recognized mechanism.
  const badAuth = apiRoutesFile.apiRoutes.filter((r) => {
    if (!r.auth || typeof r.auth !== "object") return true;
    if (typeof r.auth.mechanism !== "string" || !VALID_MECHANISMS.has(r.auth.mechanism)) return true;
    if (!Array.isArray(r.auth.tiers)) return true;
    if (typeof r.auth.requiresAuth !== "boolean") return true;
    return false;
  });
  if (badAuth.length > 0) {
    fail(
      `${badAuth.length} route(s) have a missing or malformed auth classification: ` +
        `${badAuth.slice(0, 5).map((r) => r.path).join(", ")}` +
        (badAuth.length > 5 ? ", ..." : "")
    );
    return;
  }

  // 8. isMutation must be present as a boolean on every route, and must be internally
  //    consistent with methods[] (true iff methods[] contains a POST/PUT/PATCH/DELETE).
  const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  const badMutationFlag = apiRoutesFile.apiRoutes.filter((r) => {
    if (typeof r.isMutation !== "boolean") return true;
    const shouldBeMutation = Array.isArray(r.methods) && r.methods.some((m) => MUTATION_METHODS.has(m));
    return r.isMutation !== shouldBeMutation;
  });
  if (badMutationFlag.length > 0) {
    fail(
      `${badMutationFlag.length} route(s) have an isMutation flag inconsistent with their own ` +
        `methods[]: ${badMutationFlag.slice(0, 5).map((r) => r.path).join(", ")}` +
        (badMutationFlag.length > 5 ? ", ..." : "")
    );
    return;
  }

  // 9. Declared summary counters (mutationRouteCount, flaggedForReviewCount) must match a
  //    fresh recount over apiRoutes[] -- catches the counters and the array silently drifting.
  const recomputedMutationCount = apiRoutesFile.apiRoutes.filter((r) => r.isMutation).length;
  if (apiRoutesFile.mutationRouteCount !== recomputedMutationCount) {
    fail(
      `mutationRouteCount field (${apiRoutesFile.mutationRouteCount}) does not match a fresh ` +
        `recount (${recomputedMutationCount})`
    );
    return;
  }
  const recomputedFlaggedCount = apiRoutesFile.apiRoutes.filter((r) => r.flagForReview === true).length;
  if (apiRoutesFile.flaggedForReviewCount !== recomputedFlaggedCount) {
    fail(
      `flaggedForReviewCount field (${apiRoutesFile.flaggedForReviewCount}) does not match a ` +
        `fresh recount (${recomputedFlaggedCount})`
    );
    return;
  }

  console.log(
    `PT-02-001 PASS: api-routes.json has ${actualCount} API route(s), matching PT-00 ` +
      `route-manifest.json exactly. Every route has a methods[] array and a recognized auth ` +
      `classification. ${recomputedMutationCount} mutation route(s), ` +
      `${recomputedFlaggedCount} flagged for review.`
  );
  process.exit(0);
}

main();
