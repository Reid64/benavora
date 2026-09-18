#!/usr/bin/env node
// FORGE gate - AR-11: two failure classes that hide real defects.
//
// (a) `error || !data` conflates a genuine DB error with a legitimate empty
//     result, so a broken query reports "not found". AR-7.3 fixed 16 discard
//     sites and explicitly left this broader class open.
// (b) dedup_key built with crypto.randomUUID() makes every key unique, so the
//     uq_alerts_org_dedup index never fires and those alerts never dedup at
//     all - observed in base-agent.ts, autonomous-base.ts and
//     deadline-prediction-agent.ts.
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const sh = (c) => { try { return execSync(c, { encoding: "utf8" }); } catch (e) { return e.stdout ?? ""; } };

// 1. No random component in any dedup_key.
const rnd = sh(
  `grep -rn --include=*.ts --exclude-dir=node_modules --exclude-dir=__tests__ ` +
  `-E "dedup_key.*randomUUID|randomUUID.*dedup_key" src worker || true`
).split("\n").filter(Boolean);
if (rnd.length)
  fail(`${rnd.length} dedup_key(s) still include crypto.randomUUID() - every key is unique so dedup never fires:\n       ` +
       rnd.slice(0, 6).map((l) => l.split(":").slice(0, 2).join(":")).join("\n       ") +
       (rnd.length > 6 ? `\n       ...and ${rnd.length - 6} more` : ""));

// 2. The error/empty conflation must be measurably reduced and the remainder
//    recorded, not silently left.
const LEDGER = "test-evidence/ERROR_CONFLATION_LEDGER.md";
if (!existsSync(LEDGER))
  fail(`${LEDGER} not found - record every remaining 'error || !data' site with a reason, or fix it`);
const led = readFileSync(LEDGER, "utf8");
if (!/\b\d+\b/.test(led)) fail(`${LEDGER} records no counts - it must carry before/after numbers`);

// 3. A regression test for the distinction.
const T = "src/__tests__/unit/error-vs-empty.test.ts";
if (!existsSync(T)) fail(`${T} not found - a DB error and an empty result must be provably distinguishable`);

console.log("OK: no randomised dedup keys, error/empty conflation ledgered with counts, regression test present");
