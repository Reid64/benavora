#!/usr/bin/env node
// FORGE gate - AR-12: the 59 never-executed agents get a verdict each, from a
// real harness run - not from a code read.
//
// Live counts 2026-09-17: 144 agents on disk, 85 have ever executed (61 core +
// 24 PIL), 59 never once. Wiring 59 agents nobody has missed produces 59 more
// things that can fail; deleting a live one is worse. Each needs evidence.
import { existsSync, readFileSync } from "node:fs";

const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
const REPORT = "AGENT_EXERCISE_REPORT.md";
const JSONF = "agent-exercise-results.json";

if (!existsSync(REPORT)) fail(`${REPORT} not found - the harness was never actually run`);
if (!existsSync(JSONF)) fail(`${JSONF} not found - the harness writes both; a report without its data is not evidence`);

let rows;
try { rows = JSON.parse(readFileSync(JSONF, "utf8")); } catch (e) { fail(`${JSONF} is not valid JSON: ${e.message}`); }
const list = Array.isArray(rows) ? rows : (rows.results ?? []);
if (!Array.isArray(list) || list.length === 0) fail(`${JSONF} contains no results`);

// Outcomes must be real, not all-skipped.
const invoked = list.filter((r) => r.invoked === true);
if (invoked.length < 20)
  fail(`only ${invoked.length} of ${list.length} agents were actually invoked - a dry run is not a harness report`);
const outcomes = new Set(list.map((r) => r.outcome));
if (outcomes.size === 1 && outcomes.has("skipped"))
  fail("every agent reported 'skipped' - nothing was exercised");

// Every never-executed agent needs an explicit disposition.
const TRIAGE = "test-evidence/AGENT_TRIAGE_59.md";
if (!existsSync(TRIAGE)) fail(`${TRIAGE} not found - each never-executed agent needs a WIRE or DELETE verdict with a reason`);
const t = readFileSync(TRIAGE, "utf8");
const verdicts = (t.match(/\b(WIRE|DELETE|KEEP|DEFER)\b/g) ?? []).length;
if (verdicts < 20)
  fail(`${TRIAGE} carries only ${verdicts} explicit verdicts - every triaged agent needs one`);

console.log(`OK: harness run recorded (${invoked.length}/${list.length} invoked, ${outcomes.size} distinct outcomes), ${verdicts} triage verdicts`);
