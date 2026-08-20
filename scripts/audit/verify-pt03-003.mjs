// ============================================================================
// PT-03-003 verifier -- AutoApply + Donor Discovery journeys
// (test-evidence/pt-03/autoapply-donor-journeys.json).
//
// Exits non-zero unless the file:
//   1. Exists, is non-empty, and parses as valid JSON.
//   2. Records a non-production target (local stack only -- HARD FAIL if the
//      production ref appears as an actual target rather than a comparison
//      value).
//   3. Contains a `donor_discovery.stages` array with exactly the required
//      stages, in order: prospect, review, route_to_destination.
//   4. Contains an `autoapply.stages` array with exactly the required stages,
//      in order: queue, session, form_fill, submit.
//   5. Every stage entry in either journey has a real, non-empty `before`
//      object and a real, non-empty `after` object -- a stage that silently
//      no-oped and never captured state would show up as missing/empty,
//      which is a hard failure here, not a warning.
//   6. Every stage entry has an `assertion.pass` boolean and a non-empty
//      `description` -- present whether the stage passed or not (a failing
//      stage honestly recorded as a finding is allowed; a *missing* stage
//      record is not).
//   7. Every stage entry has a non-empty `screenshots` array, and every
//      screenshot path referenced anywhere in the file actually exists on
//      disk (relative to the repo root) and is non-empty.
//   8. `donor_discovery.terminal_state` and `autoapply.terminal_state` are
//      both present and non-null -- both journeys must record a full step
//      chain that actually reaches a terminal state, not just a partial run.
//   9. `autoapply.no_external_http_calls_made` is exactly `true`, and every
//      autoapply stage marked `simulated: true` carries
//      `after.external_http_calls_made === 0` -- the file must make the
//      "never a real external submission" claim checkably, not just in prose.
//   10. If `findings` is non-empty, each finding has the required fields
//       (id, journey, stage, severity, description, evidence).
//
// This verifier does NOT require every stage to have passed -- a stage that
// genuinely failed and was honestly recorded as a finding is exactly what
// this task's own instructions call for. What it requires is that no stage
// silently no-oped, that both journeys reached a real terminal state, and
// that the "safe simulated, never real" claim is independently checkable.
//
// Usage: node scripts/audit/verify-pt03-003.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const JOURNEY_JSON = path.join("test-evidence", "pt-03", "autoapply-donor-journeys.json");
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

const REQUIRED_DD_STAGES = ["prospect", "review", "route_to_destination"];
const REQUIRED_AA_STAGES = ["queue", "session", "form_fill", "submit"];
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
// that is a harness/error placeholder, NOT real state, and must not satisfy
// "records before/after state." Reject it explicitly.
const PLACEHOLDER_ONLY_KEYS = new Set(["note", "error"]);
function isRealState(value) {
  if (!isNonEmptyObject(value)) return false;
  return Object.keys(value).some((k) => !PLACEHOLDER_ONLY_KEYS.has(k));
}

function verifyJourneyStages(journeyName, journeyData, requiredStages, allScreenshotPaths) {
  if (!journeyData || !Array.isArray(journeyData.stages)) {
    fail(`"${journeyName}.stages" is missing or not an array.`);
    return [];
  }
  const stageNames = journeyData.stages.map((s) => s?.stage);
  console.log(`${journeyName} stages recorded: ${stageNames.join(", ") || "(none)"}`);

  for (const required of requiredStages) {
    const idx = stageNames.indexOf(required);
    if (idx === -1) {
      fail(`Required stage "${journeyName}.${required}" is missing entirely.`);
      continue;
    }
    const entry = journeyData.stages[idx];

    if (!isRealState(entry.before)) {
      fail(`Stage "${journeyName}.${required}" has no real (non-empty, non-placeholder) "before" state -- looks like it never captured before-state.`);
    }
    if (!isRealState(entry.after)) {
      fail(`Stage "${journeyName}.${required}" has no real (non-empty, non-placeholder) "after" state -- looks like it silently no-oped, crashed, or was skipped.`);
    }
    if (typeof entry.assertion !== "object" || entry.assertion === null || typeof entry.assertion.pass !== "boolean") {
      fail(`Stage "${journeyName}.${required}" has no assertion.pass boolean -- cannot tell whether the stage was actually checked.`);
    }
    if (typeof entry.description !== "string" || entry.description.trim().length === 0) {
      fail(`Stage "${journeyName}.${required}" has no description of what was done.`);
    }
    if (!Array.isArray(entry.screenshots) || entry.screenshots.length === 0) {
      fail(`Stage "${journeyName}.${required}" has no screenshots recorded.`);
    } else {
      for (const p of entry.screenshots) allScreenshotPaths.add(p);
    }

    // Any stage marked simulated must make the "no real external call" claim
    // checkably, not just describe it in prose.
    if (entry.simulated === true) {
      if (entry.after?.external_http_calls_made !== 0) {
        fail(`Stage "${journeyName}.${required}" is marked simulated:true but its "after" object does not record external_http_calls_made === 0.`);
      }
    }

    if (
      isRealState(entry.before) &&
      isRealState(entry.after) &&
      typeof entry.assertion?.pass === "boolean" &&
      Array.isArray(entry.screenshots) &&
      entry.screenshots.length > 0
    ) {
      pass(
        `Stage "${journeyName}.${required}": before/after state recorded, screenshot(s) present, assertion.pass=${entry.assertion.pass}` +
          (entry.assertion.pass ? "" : " (recorded as failing -- see findings, this is expected/allowed by this verifier)"),
      );
    }
  }

  if (stageNames.length !== requiredStages.length) {
    fail(
      `Expected exactly ${requiredStages.length} stages for "${journeyName}" (${requiredStages.join(", ")}), found ${stageNames.length} (${stageNames.join(", ") || "none"}).`,
    );
  } else {
    const orderMatches = requiredStages.every((s, i) => stageNames[i] === s);
    if (!orderMatches) {
      fail(`"${journeyName}" stages are present but not in the expected order. Expected [${requiredStages.join(", ")}], got [${stageNames.join(", ")}].`);
    } else {
      pass(`All ${requiredStages.length} required "${journeyName}" stages present, in the correct order.`);
    }
  }

  return stageNames;
}

function main() {
  if (!fs.existsSync(JOURNEY_JSON)) {
    hardFail(`${JOURNEY_JSON} does not exist. The AutoApply + Donor Discovery journey script must run and write this file before verification.`);
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
  const target = data.target ?? {};
  const ACTUAL_TARGET_FIELDS = ["host", "port", "database", "api_base"];
  const badFields = ACTUAL_TARGET_FIELDS.filter(
    (k) => target[k] !== undefined && String(target[k]).includes(PRODUCTION_REF),
  );
  if (badFields.length > 0) {
    hardFail(
      `"target" contains the production ref "${PRODUCTION_REF}" in actual target field(s): ${badFields.join(", ")}. ` +
        `PT-03 must never record a production write target.`,
    );
  }
  if (target.is_production !== false) {
    fail(`"target.is_production" is not explicitly false (got: ${JSON.stringify(target.is_production)}).`);
  } else {
    pass(`Target recorded as non-production (is_production: false, no production ref present in actual target fields).`);
  }

  // --- Both journeys' stage chains ----------------------------------------
  const allScreenshotPaths = new Set();
  verifyJourneyStages("donor_discovery", data.donor_discovery, REQUIRED_DD_STAGES, allScreenshotPaths);
  verifyJourneyStages("autoapply", data.autoapply, REQUIRED_AA_STAGES, allScreenshotPaths);

  // --- Both journeys must reach a real, non-null terminal state -----------
  if (!isRealState(data.donor_discovery?.terminal_state)) {
    fail(`"donor_discovery.terminal_state" is missing, null, or empty -- the journey did not record a full step chain reaching a terminal state.`);
  } else {
    pass(`"donor_discovery.terminal_state" is present and non-empty: ${JSON.stringify(data.donor_discovery.terminal_state)}`);
  }
  if (!isRealState(data.autoapply?.terminal_state)) {
    fail(`"autoapply.terminal_state" is missing, null, or empty -- the journey did not record a full step chain reaching a terminal state.`);
  } else {
    pass(`"autoapply.terminal_state" is present and non-empty: ${JSON.stringify(data.autoapply.terminal_state)}`);
  }

  // --- "Never a real external submission" must be checkable, not just prose
  if (data.autoapply?.no_external_http_calls_made !== true) {
    fail(`"autoapply.no_external_http_calls_made" is not exactly true -- the "never a real external submission" claim is not checkably recorded.`);
  } else {
    pass(`"autoapply.no_external_http_calls_made" === true.`);
  }

  // --- Every referenced screenshot must actually exist on disk -----------
  let missingShots = 0;
  for (const relPath of allScreenshotPaths) {
    const abs = path.resolve(relPath);
    if (!fs.existsSync(abs)) {
      fail(`Screenshot referenced in autoapply-donor-journeys.json does not exist on disk: ${relPath}`);
      missingShots++;
      continue;
    }
    const size = fs.statSync(abs).size;
    if (size === 0) {
      fail(`Screenshot referenced in autoapply-donor-journeys.json exists but is empty (0 bytes): ${relPath}`);
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
      const missing = ["id", "journey", "stage", "severity", "description", "evidence"].filter(
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
      pass(`All ${data.findings.length} recorded finding(s) are well-formed.`);
    }
    console.log(`Findings summary: ${data.findings.length} finding(s) -- ${data.findings.map((f) => `${f.id}[${f.severity}]`).join(", ")}`);
  } else {
    pass(`No findings recorded (every stage's assertion passed cleanly), or "findings" is a valid empty array.`);
  }

  // --- Summary block sanity check -----------------------------------------
  if (data.summary && typeof data.summary.donor_discovery_stages_total === "number" && typeof data.summary.autoapply_stages_total === "number") {
    const ddCount = Array.isArray(data.donor_discovery?.stages) ? data.donor_discovery.stages.length : 0;
    const aaCount = Array.isArray(data.autoapply?.stages) ? data.autoapply.stages.length : 0;
    if (data.summary.donor_discovery_stages_total !== ddCount) {
      fail(`summary.donor_discovery_stages_total (${data.summary.donor_discovery_stages_total}) does not match the actual stages array length (${ddCount}).`);
    }
    if (data.summary.autoapply_stages_total !== aaCount) {
      fail(`summary.autoapply_stages_total (${data.summary.autoapply_stages_total}) does not match the actual stages array length (${aaCount}).`);
    }
  } else {
    fail(`autoapply-donor-journeys.json has no valid "summary.donor_discovery_stages_total"/"summary.autoapply_stages_total" fields.`);
  }

  if (errors > 0) {
    console.error(`\n${errors} error(s) found.`);
    process.exit(1);
  }

  console.log(
    `\nPASS: ${JOURNEY_JSON} records both required journeys (donor_discovery: ${REQUIRED_DD_STAGES.join(", ")}; ` +
      `autoapply: ${REQUIRED_AA_STAGES.join(", ")}), each with real before/after state, screenshots, a terminal ` +
      `state, and a checkable no-external-calls guarantee; every referenced screenshot exists on disk; the ` +
      `recorded target is non-production.`,
  );
  process.exit(0);
}

main();
