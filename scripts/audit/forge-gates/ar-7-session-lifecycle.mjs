#!/usr/bin/env node
// FORGE gate - AR-7.2: automation_sessions must reach a terminal state.
//
// Production evidence 2026-09-17: autoapply_queue_processor has 32 runs and
// ZERO successes. Its recurring error is
//   concurrent_automation_conflict: active automation_sessions row <id> exists
// and it fires roughly hourly. Seven non-terminal automation_sessions rows are
// live, the oldest 99 DAYS old, and EVERY ONE has updated_at == created_at -
// not one has ever been touched after insert. The mutual-exclusion guard sees
// them as active forever, so the AutoApply pipeline is permanently deadlocked
// and the Phase 3 submit-integrity fix has never executed in production.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// 1. A reaper must exist for sessions that never finalize.
const candidates = [
  "worker/stale-session-reaper.ts",
  "worker/automation-session-reaper.ts",
  "worker/stuck-run-watchdog.ts",
];
const present = candidates.filter((p) => existsSync(p));
if (!present.length) fail(`no session reaper found (looked for: ${candidates.join(", ")})`);
const reaper = present.map(read).join("\n");
if (!/automation_sessions/.test(reaper))
  fail(`${present.join(", ")} does not touch automation_sessions - stale sessions still deadlock the queue forever`);
if (!/updated_at|last_activity|heartbeat/.test(reaper))
  fail("the reaper has no staleness signal (updated_at / heartbeat) - it cannot tell a live session from an abandoned one");

// 2. Every terminal path in the queue processor must finalize the session.
const qp = read("worker/queue-processor.ts");
if (!qp) fail("worker/queue-processor.ts not found");
const finalizeCalls = (qp.match(/finalizeAutomationSession\s*\(/g) ?? []).length;
if (finalizeCalls < 2)
  fail(`finalizeAutomationSession is called ${finalizeCalls} time(s) - a single call site cannot cover the throw paths ` +
       `(IncompleteSubmissionError, SubmissionNotVerifiedError) introduced by AR-3.1`);
if (!/finally\s*\{[\s\S]{0,600}?finalizeAutomationSession/.test(qp) &&
    !/catch\s*\([\s\S]{0,400}?finalizeAutomationSession/.test(qp))
  fail("finalizeAutomationSession is never reached from a catch or finally block - a thrown error leaves the session active forever");

// 3. A regression test must prove a thrown error still finalizes.
const TEST = "src/__tests__/integration/automation-session-lifecycle.test.ts";
if (!existsSync(TEST)) fail(`${TEST} not found - the deadlock needs a standing guard`);
const t = read(TEST);
if (!/throw|reject|Error/.test(t))
  fail(`${TEST} does not exercise a failure path - the deadlock only happens when something throws`);

console.log(`OK: session reaper present, finalizeAutomationSession reached from ${finalizeCalls} sites including an error path, regression test in place`);
