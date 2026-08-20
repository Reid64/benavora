// ============================================================================
// PT-03-002 verifier -- core signup-to-deadline journey.
//
// Exits non-zero unless test-evidence/pt-03/core-journey.json:
//   1. Exists, is non-empty, and parses as valid JSON.
//   2. Records a non-production target (local stack only -- HARD FAIL if the
//      production ref appears as an actual target rather than a comparison
//      value).
//   3. Contains a `stages` array with exactly one entry per required stage
//      (signup, onboarding, discovery, draft, pipeline, deadline) -- every
//      stage the core journey prompt named, in order.
//   4. Every one of those stage entries has a real, non-empty `before` object
//      and a real, non-empty `after` object (the actual point of this
//      verifier: a stage that silently no-oped and never captured DB state
//      would show up as a missing or empty before/after, which this script
//      treats as a hard failure, not just a warning).
//   5. Every stage entry has an `assertion` object with a boolean `pass`
//      field -- present whether the stage passed or not (a failing stage is
//      still required to have recorded its before/after state; only a
//      *missing* stage record is a verifier failure).
//   6. Every screenshot path referenced anywhere in the file actually exists
//      on disk at that path (relative to the repo root) and is non-empty --
//      not just referenced.
//   7. If `findings` is non-empty, each finding has the required fields
//      (id, stage, severity, description, evidence) -- a malformed finding
//      record is itself a verifier failure, since it means a real defect
//      would be under-documented.
//
// This verifier does NOT require every stage to have passed -- a stage that
// genuinely failed and was honestly recorded as a finding is exactly what
// PT-03-002's own instructions call for. What it does require is that no
// stage silently no-oped without ever capturing real before/after state.
//
// Usage: node scripts/audit/verify-pt03-002.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const JOURNEY_JSON = path.join("test-evidence", "pt-03", "core-journey.json");
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

const REQUIRED_STAGES = ["signup", "onboarding", "discovery", "draft", "pipeline", "deadline"];
const VALID_SEVERITIES = ["P0", "P1", "P2", "P3"];

let errors = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}
function hardFail(message) {
  console.error(`HARD FAIL: ${message}`);
  process.exit(1);
}
function pass(message) {
  console.log(`PASS: ${message}`);
}

function isNonEmptyObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

// A stage that threw before it could query the DB might still record a
// non-empty before/after object shaped like {note: "...", error: "..."} --
// that is a harness/error placeholder, NOT real DB row state, and must not
// satisfy "records before/after DB state." Reject it explicitly: real DB
// state objects always carry at least one key outside this placeholder set.
const PLACEHOLDER_ONLY_KEYS = new Set(["note", "error"]);
function isRealDbState(value) {
  if (!isNonEmptyObject(value)) return false;
  return Object.keys(value).some((k) => !PLACEHOLDER_ONLY_KEYS.has(k));
}

function main() {
  if (!fs.existsSync(JOURNEY_JSON)) {
    hardFail(`${JOURNEY_JSON} does not exist. PT-03-002 must run and write this file before verification.`);
  }
  const raw = fs.readFileSync(JOURNEY_JSON, "utf8");
  if (raw.trim().length === 0) {
    hardFail(`${JOURNEY_JSON} exists but is empty.`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    hardFail(`${JOURNEY_JSON} does not parse as valid JSON: ${err.message}`);
  }
  pass(`${JOURNEY_JSON} exists, is non-empty, and parses as valid JSON.`);

  // --- Target must be non-production -----------------------------------
  // Check actual target fields individually (host/port/database/api_base),
  // not a blanket stringify of the whole object -- "production_ref_for_comparison"
  // is an intentional, expected field (same pattern as verify-pt03-001.mjs)
  // that documents the production ref for negative comparison, and must not
  // itself trip a hard fail.
  const target = data.target ?? {};
  const ACTUAL_TARGET_FIELDS = ["host", "port", "database", "api_base"];
  const badFields = ACTUAL_TARGET_FIELDS.filter(
    (k) => target[k] !== undefined && String(target[k]).includes(PRODUCTION_REF),
  );
  if (badFields.length > 0) {
    hardFail(
      `core-journey.json's "target" field contains the production ref "${PRODUCTION_REF}" in ` +
        `actual target field(s): ${badFields.join(", ")}. PT-03 must never record a production write target.`,
    );
  }
  if (target.is_production !== false) {
    fail(`core-journey.json's "target.is_production" is not explicitly false (got: ${JSON.stringify(target.is_production)}).`);
  } else {
    pass(`Target recorded as non-production (is_production: false, no production ref present in actual target fields).`);
  }

  // --- stages array must exist and cover every required stage, in order --
  if (!Array.isArray(data.stages)) {
    hardFail(`core-journey.json's "stages" field is not an array.`);
  }

  const stageNames = data.stages.map((s) => s?.stage);
  console.log(`Stages recorded: ${stageNames.join(", ") || "(none)"}`);

  for (const required of REQUIRED_STAGES) {
    const idx = stageNames.indexOf(required);
    if (idx === -1) {
      fail(`Required stage "${required}" is missing from core-journey.json's stages array entirely.`);
      continue;
    }
    const entry = data.stages[idx];

    if (!isRealDbState(entry.before)) {
      fail(`Stage "${required}" has no real (non-empty, non-placeholder) "before" DB-state object -- looks like it never captured before-state, or only recorded a harness error placeholder ({note, error}).`);
    }
    if (!isRealDbState(entry.after)) {
      fail(`Stage "${required}" has no real (non-empty, non-placeholder) "after" DB-state object -- looks like it never captured after-state (silent no-op, harness crash, or the check itself was skipped).`);
    }
    if (typeof entry.assertion !== "object" || entry.assertion === null || typeof entry.assertion.pass !== "boolean") {
      fail(`Stage "${required}" has no assertion.pass boolean -- cannot tell whether persistence was actually checked.`);
    }
    if (typeof entry.description !== "string" || entry.description.trim().length === 0) {
      fail(`Stage "${required}" has no description of what was done.`);
    }
    if (!Array.isArray(entry.screenshots) || entry.screenshots.length === 0) {
      fail(`Stage "${required}" has no screenshots recorded.`);
    }

    if (isRealDbState(entry.before) && isRealDbState(entry.after) && typeof entry.assertion?.pass === "boolean") {
      pass(
        `Stage "${required}": before/after DB state both recorded, assertion.pass=${entry.assertion.pass}` +
          (entry.assertion.pass ? "" : " (recorded as failing -- see findings, this is expected/allowed by this verifier)"),
      );
    }
  }

  if (stageNames.length !== REQUIRED_STAGES.length) {
    fail(
      `Expected exactly ${REQUIRED_STAGES.length} stages (${REQUIRED_STAGES.join(", ")}), found ${stageNames.length} (${stageNames.join(", ") || "none"}).`,
    );
  } else {
    const orderMatches = REQUIRED_STAGES.every((s, i) => stageNames[i] === s);
    if (!orderMatches) {
      fail(`Stages are present but not in the expected journey order. Expected [${REQUIRED_STAGES.join(", ")}], got [${stageNames.join(", ")}].`);
    } else {
      pass(`All ${REQUIRED_STAGES.length} required stages present, in the correct journey order.`);
    }
  }

  // --- Every referenced screenshot must actually exist on disk -----------
  const allScreenshotPaths = new Set();
  for (const s of data.stages ?? []) {
    for (const p of s.screenshots ?? []) {
      allScreenshotPaths.add(p);
    }
  }
  let missingShots = 0;
  for (const relPath of allScreenshotPaths) {
    const abs = path.resolve(relPath);
    if (!fs.existsSync(abs)) {
      fail(`Screenshot referenced in core-journey.json does not exist on disk: ${relPath}`);
      missingShots++;
      continue;
    }
    const size = fs.statSync(abs).size;
    if (size === 0) {
      fail(`Screenshot referenced in core-journey.json exists but is empty (0 bytes): ${relPath}`);
      missingShots++;
    }
  }
  if (allScreenshotPaths.size > 0 && missingShots === 0) {
    pass(`All ${allScreenshotPaths.size} referenced screenshot(s) exist on disk and are non-empty.`);
  }

  // --- Findings, if any, must be well-formed ------------------------------
  if (Array.isArray(data.findings) && data.findings.length > 0) {
    let malformed = 0;
    for (const f of data.findings) {
      const missing = ["id", "stage", "severity", "description", "evidence"].filter(
        (k) => !f || f[k] === undefined || f[k] === null || f[k] === "",
      );
      if (missing.length > 0) {
        fail(`Finding ${f?.id ?? "(no id)"} is missing required field(s): ${missing.join(", ")}.`);
        malformed++;
        continue;
      }
      if (!VALID_SEVERITIES.includes(f.severity)) {
        fail(`Finding ${f.id} has an invalid severity "${f.severity}" (expected one of ${VALID_SEVERITIES.join(", ")}).`);
        malformed++;
      }
    }
    if (malformed === 0) {
      pass(`All ${data.findings.length} recorded finding(s) are well-formed (id/stage/severity/description/evidence all present, valid severity).`);
    }
    console.log(`Findings summary: ${data.findings.length} finding(s) recorded -- ${data.findings.map((f) => `${f.id}[${f.severity}]`).join(", ")}`);
  } else {
    pass(`No findings recorded (every stage's assertion passed cleanly), or "findings" is a valid empty array.`);
  }

  // --- Summary block sanity check -----------------------------------------
  if (data.summary && typeof data.summary.total_stages === "number") {
    if (data.summary.total_stages !== stageNames.length) {
      fail(`summary.total_stages (${data.summary.total_stages}) does not match the actual stages array length (${stageNames.length}).`);
    }
  } else {
    fail(`core-journey.json has no valid "summary.total_stages" field.`);
  }

  if (errors > 0) {
    console.error(`\n${errors} error(s) found.`);
    process.exit(1);
  }

  console.log(
    `\nPASS: ${JOURNEY_JSON} records all ${REQUIRED_STAGES.length} required stages (${REQUIRED_STAGES.join(", ")}), ` +
      `each with real before/after DB state, a screenshot, and a pass/fail assertion; every referenced screenshot ` +
      `exists on disk; the recorded target is non-production.`,
  );
  process.exit(0);
}

main();
