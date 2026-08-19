#!/usr/bin/env node
// PT-00-003 verifier: confirms the authoritative route manifest exists and is
// structurally sound -- parses as JSON, has a non-empty routes array, and
// carries both nav-items.ts cross-reference keys (deadNav, orphanRoutes).
//
// Exits non-zero unless:
//   1. test-evidence/pt-00/route-manifest.json exists and is non-empty
//   2. it parses as JSON
//   3. its top-level "routes" array is present and non-empty
//   4. its top-level "deadNav" key is present (array, may be empty)
//   5. its top-level "orphanRoutes" key is present (array, may be empty)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const manifestPath = path.join(repoRoot, "test-evidence", "pt-00", "route-manifest.json");

function fail(reason) {
  console.error(`PT-00-003 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  let manifest;
  try {
    manifest = assertJsonFileHasKey(manifestPath, "routes");
  } catch (err) {
    fail(`route-manifest.json check failed: ${err.message}`);
    return;
  }

  if (!Array.isArray(manifest.routes) || manifest.routes.length === 0) {
    fail('"routes" must be a non-empty array');
    return;
  }

  for (const key of ["deadNav", "orphanRoutes"]) {
    if (!(key in manifest)) {
      fail(`missing required cross-reference key "${key}"`);
      return;
    }
    if (!Array.isArray(manifest[key])) {
      fail(`"${key}" must be an array`);
      return;
    }
  }

  const requiredRouteFields = ["path", "type", "file", "dynamic"];
  for (const [index, route] of manifest.routes.entries()) {
    for (const field of requiredRouteFields) {
      if (!(field in route)) {
        fail(`routes[${index}] is missing required field "${field}"`);
        return;
      }
    }
    if (route.type !== "page" && route.type !== "api") {
      fail(`routes[${index}].type must be "page" or "api", got ${JSON.stringify(route.type)}`);
      return;
    }
  }

  const pageCount = manifest.routes.filter((r) => r.type === "page").length;
  const apiCount = manifest.routes.filter((r) => r.type === "api").length;

  console.log(
    `PT-00-003 PASS: route-manifest.json parses, ${manifest.routes.length} routes ` +
      `(${pageCount} pages, ${apiCount} api), deadNav=${manifest.deadNav.length}, ` +
      `orphanRoutes=${manifest.orphanRoutes.length}.`
  );
  process.exit(0);
}

main();
