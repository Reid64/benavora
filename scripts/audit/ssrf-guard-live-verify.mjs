// Live, non-mocked verification of the shared SSRF guard — calls the real
// assertUrlSafe() (real DNS resolution, no stubs) against each of the
// required block/allow cases and records real pass/fail results.
//
// Run: npx tsx scripts/audit/ssrf-guard-live-verify.mjs

import fs from "node:fs";
import path from "node:path";
import { assertUrlSafe } from "../../src/lib/security/ssrf-guard.ts";

const OUT_DIR = path.join(process.cwd(), "test-evidence", "remediation", "ssrf-fix");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BLOCK_CASES = [
  { name: "cloud-metadata-ip", url: "http://169.254.169.254/latest/meta-data/" },
  { name: "localhost", url: "http://localhost" },
  { name: "loopback-ip", url: "http://127.0.0.1" },
  { name: "rfc1918-10", url: "http://10.0.0.1" },
  { name: "rfc1918-192-168", url: "http://192.168.1.1" },
  { name: "non-http-file", url: "file:///etc/passwd" },
  { name: "non-http-gopher", url: "gopher://internal:70/" },
];

const ALLOW_CASES = [{ name: "public-https", url: "https://www.google.com/" }];

async function main() {
  const results = { capturedAt: new Date().toISOString(), block: [], allow: [] };

  for (const { name, url } of BLOCK_CASES) {
    try {
      const addr = await assertUrlSafe(url);
      results.block.push({ name, url, expected: "block", actual: "ALLOWED (FAIL)", resolved: addr });
    } catch (err) {
      results.block.push({
        name,
        url,
        expected: "block",
        actual: "blocked",
        errorName: err?.name,
        errorMessage: err?.message,
      });
    }
  }

  for (const { name, url } of ALLOW_CASES) {
    try {
      const addr = await assertUrlSafe(url);
      results.allow.push({ name, url, expected: "allow", actual: "allowed", resolved: addr });
    } catch (err) {
      results.allow.push({
        name,
        url,
        expected: "allow",
        actual: `BLOCKED (FAIL): ${err?.message}`,
      });
    }
  }

  const blockFailures = results.block.filter((r) => r.actual !== "blocked");
  const allowFailures = results.allow.filter((r) => r.actual !== "allowed");
  results.summary = {
    totalBlockCases: BLOCK_CASES.length,
    blockCasesCorrectlyBlocked: BLOCK_CASES.length - blockFailures.length,
    totalAllowCases: ALLOW_CASES.length,
    allowCasesCorrectlyAllowed: ALLOW_CASES.length - allowFailures.length,
    allPassed: blockFailures.length === 0 && allowFailures.length === 0,
  };

  const outFile = path.join(OUT_DIR, "ssrf-guard-live-verify.json");
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.summary, null, 2));
  console.log(`wrote ${outFile}`);

  if (!results.summary.allPassed) {
    process.exit(1);
  }
}

main();
