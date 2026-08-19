// PT-01-001 verifier: confirms the page-route working set was extracted correctly
// from PT-00's route manifest -- proves nothing was dropped in the process.
// Exits 0 only if all checks pass; exits 1 with a printed reason on any failure.
// ASCII only. Node 20 compatible.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const manifestPath = path.join(repoRoot, "test-evidence", "pt-00", "route-manifest.json");
const pageRoutesPath = path.join(repoRoot, "test-evidence", "pt-01", "page-routes.json");

function fail(reason) {
  console.error(`PT-01-001 FAIL: ${reason}`);
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

  const expectedCount = manifest.routes.filter((r) => r && r.type === "page").length;

  // 2. page-routes.json must exist and parse, with a pageRoutes[] array.
  let pageRoutesFile;
  try {
    pageRoutesFile = assertJsonFileHasKey(pageRoutesPath, "pageRoutes");
  } catch (err) {
    fail(`page-routes.json check failed: ${err.message}`);
    return;
  }
  if (!Array.isArray(pageRoutesFile.pageRoutes)) {
    fail(`pageRoutes[] is not an array in ${pageRoutesPath}`);
    return;
  }

  const actualCount = pageRoutesFile.pageRoutes.length;

  // 3. Declared pageRouteCount must match the actual array length.
  if (pageRoutesFile.pageRouteCount !== actualCount) {
    fail(
      `pageRouteCount field (${pageRoutesFile.pageRouteCount}) does not match ` +
        `pageRoutes[] length (${actualCount}) in ${pageRoutesPath}`
    );
    return;
  }

  // 4. Every entry in the working set must actually be type == "page".
  const nonPage = pageRoutesFile.pageRoutes.filter((r) => !r || r.type !== "page");
  if (nonPage.length > 0) {
    fail(`page-routes.json contains ${nonPage.length} entrie(s) that are not type=="page"`);
    return;
  }

  // 5. The core proof: count must match PT-00's type=="page" count exactly.
  if (actualCount !== expectedCount) {
    fail(
      `page-routes.json has ${actualCount} route(s), but PT-00 route-manifest.json has ` +
        `${expectedCount} type=="page" entries -- counts do not match, routes may have been dropped`
    );
    return;
  }

  console.log(
    `PT-01-001 PASS: page-routes.json has ${actualCount} page route(s), matching PT-00 route-manifest.json exactly.`
  );
  process.exit(0);
}

main();
