// Live, non-mocked verification of safeFetch() itself (not just the guard
// primitive) — proves a real local listener standing in for an internal
// service is genuinely never reached, and a real public URL's response
// really does come back through the pinned-request path.
//
// Run: npx tsx scripts/audit/safefetch-live-verify.mjs

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { safeFetch, SsrfBlockedError } from "../../src/lib/security/safe-fetch.ts";

const OUT_DIR = path.join(process.cwd(), "test-evidence", "remediation", "ssrf-fix");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  const results = { capturedAt: new Date().toISOString() };

  // 1. Real local loopback listener standing in for an internal service —
  //    confirm safeFetch never reaches it.
  let hitCount = 0;
  const server = http.createServer((_req, res) => {
    hitCount++;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("internal service marker payload — should never be delivered");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    await safeFetch(`http://127.0.0.1:${port}/`, { timeoutMs: 3000 });
    results.loopbackBlocked = { pass: false, detail: "safeFetch did NOT throw — SSRF not blocked" };
  } catch (err) {
    results.loopbackBlocked = {
      pass: err instanceof SsrfBlockedError,
      errorName: err?.name,
      errorMessage: err?.message,
      listenerHitCount: hitCount,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // 2. Real public URL — confirm a real response actually comes back.
  try {
    const res = await safeFetch("https://www.google.com/", { timeoutMs: 10000 });
    results.publicUrlAllowed = {
      pass: res.status > 0 && res.body.length > 0,
      status: res.status,
      bodyLength: res.body.length,
      finalUrl: res.finalUrl,
    };
  } catch (err) {
    results.publicUrlAllowed = { pass: false, error: err?.message };
  }

  results.summary = {
    allPassed: results.loopbackBlocked.pass === true && results.publicUrlAllowed.pass === true,
  };

  const outFile = path.join(OUT_DIR, "safefetch-live-verify.json");
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));

  if (!results.summary.allPassed) process.exit(1);
}

main();
