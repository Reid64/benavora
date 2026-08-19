// PT-01 preflight: extracts the page-route working set from PT-00's route manifest.
// Reads test-evidence/pt-00/route-manifest.json, filters routes[] to type == "page",
// and writes test-evidence/pt-01/page-routes.json. ASCII only. Node 20 compatible.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey, timestamp } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const manifestPath = path.join(repoRoot, "test-evidence", "pt-00", "route-manifest.json");
const outDir = path.join(repoRoot, "test-evidence", "pt-01");
const outPath = path.join(outDir, "page-routes.json");

function main() {
  const manifest = assertJsonFileHasKey(manifestPath, "routes");

  if (!Array.isArray(manifest.routes)) {
    throw new Error(`pt01-extract-page-routes: routes[] is not an array in ${manifestPath}`);
  }

  const pageRoutes = manifest.routes.filter((r) => r && r.type === "page");

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const output = {
    generatedAt: timestamp(),
    sourceManifest: path.relative(repoRoot, manifestPath).replace(/\\/g, "/"),
    pageRouteCount: pageRoutes.length,
    pageRoutes,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(`pt01-extract-page-routes: wrote ${pageRoutes.length} page route(s) to ${path.relative(repoRoot, outPath)}`);
}

main();
