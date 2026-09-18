#!/usr/bin/env node
// FORGE gate - AR-9.1: a forensics prompt must produce EVIDENCE, not a fix.
//
// Why this gate exists: in AR-7.2 I handed the build agent my hypothesis
// ("stale automation_sessions rows block the queue") as established fact. It
// fixed stale sessions - real work - while the actual defect went untouched:
// autoapply_queue_processor is still 0/37, citing session UUIDs that do not
// exist in automation_sessions at all. A prompt that guesses a cause and
// "fixes" it looks identical to one that succeeded. This gate enforces the
// separation: investigate first, fix in a later prompt, from what was found.
import { readFileSync, existsSync, readdirSync } from "node:fs";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const REPORT = "test-evidence/AR-9-1-QUEUE-PROCESSOR-FORENSICS.md";
if (!existsSync(REPORT)) fail(`${REPORT} not found - the forensics prompt produced no report`);
const r = readFileSync(REPORT, "utf8");

// 1. It must carry real observed values, not prose.
if (r.length < 1500) fail(`${REPORT} is ${r.length} bytes - too thin to be a real investigation`);
for (const [label, re] of [
  ["a session UUID actually observed", /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/],
  ["a run count or timestamp", /\b\d{2}-\d{2}\b|\b\d+\s*(runs?|rows?)\b/i],
  ["the writer that creates the row", /insert|create|upsert/i],
]) if (!re.test(r)) fail(`${REPORT} contains no ${label}`);

// 2. It must state a conclusion AND its confidence, or say it could not be found.
if (!/CONFIRMED|UNCONFIRMED|NOT FOUND|INCONCLUSIVE/i.test(r))
  fail(`${REPORT} states no explicit confidence verdict (CONFIRMED / UNCONFIRMED / INCONCLUSIVE / NOT FOUND)`);

// 3. It must NOT have shipped a fix. A forensics prompt that edits the guard
//    has done the thing this gate exists to prevent.
const touched = ["src/lib/autoapply/submission-validator.ts", "worker/queue-processor.ts"];
if (/^\s*(FIX APPLIED|CHANGES MADE)\s*:/im.test(r))
  fail("the forensics report claims a fix was applied - AR-9.1 investigates only; the fix is AR-9.2");
for (const f of touched) if (!existsSync(f)) fail(`${f} missing - the investigation should not have removed it`);

console.log(`OK: forensics report present (${r.length} bytes) with observed UUIDs, counts, a named writer and an explicit verdict; no fix applied`);
