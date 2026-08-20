// ============================================================================
// PT-07-004 verifier -- Resend / Stripe / Google Calendar integration probes.
//
// Exits non-zero unless test-evidence/pt-07/comms-billing.json exists, is
// valid JSON, and each of the three integrations (resend, stripe,
// googleCalendar) records EITHER:
//   (a) a real, non-empty probe result (a dry-run / live-send / functional
//       signature test / live table query with actual captured data), OR
//   (b) an explicit verdict of "PENDING-SCOPE" with a non-empty
//       verdictReason explaining why.
//
// A missing section, a missing verdict, or a "PENDING-SCOPE" verdict with no
// reason string all fail this verifier -- per the task's own requirement
// that every integration record a real result or an explicit reasoned
// PENDING-SCOPE, never silence.
//
// Also fails if the Stripe webhook signature-verification functional test
// (webhookSignatureFunctionalTest) did not pass -- a broken signature check
// is a finding regardless of whether billing itself is configured, per the
// task's own instruction that "any broken delivery path or invalid signature
// handling is a finding."
//
// Usage: node scripts/audit/verify-pt07-004.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const STATE_FILE = path.join("test-evidence", "pt-07", "comms-billing.json");

let errors = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}
function ok(message) {
  console.log(`OK: ${message}`);
}

if (!fs.existsSync(STATE_FILE)) {
  fail(`${STATE_FILE} does not exist.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

const raw = fs.readFileSync(STATE_FILE, "utf8");
if (raw.trim().length === 0) {
  fail(`${STATE_FILE} is empty.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`${STATE_FILE} is not valid JSON: ${err.message}`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

const VALID_VERDICTS = new Set([
  "PENDING-SCOPE",
  "NEEDS_LIVE_SEND_TEST",
  "NEEDS_LIVE_READ_TEST",
  "CONFIGURED_NOT_LIVE_TESTED",
  "LIVE_SEND_PASS",
  "LIVE_SEND_FAIL",
  "LIVE_TEST_PASS",
  "LIVE_TEST_FAIL",
]);

/**
 * A section "records a real result or an explicit PENDING-SCOPE with
 * reason" iff:
 *   - it has a `verdict` field that is one of the recognized values, AND
 *   - it has a non-empty `verdictReason` string, AND
 *   - if verdict === "PENDING-SCOPE", the reason string is not a placeholder
 *     (must be at least 20 chars -- long enough to actually explain why,
 *     not just "TODO" or "n/a").
 */
function checkSection(name, section, requiredEvidenceKeys) {
  if (!section || typeof section !== "object") {
    fail(`${name} section is missing or not an object.`);
    return;
  }

  if (typeof section.verdict !== "string" || section.verdict.trim().length === 0) {
    fail(`${name}.verdict is missing or empty -- no real result and no explicit PENDING-SCOPE recorded.`);
  } else if (!VALID_VERDICTS.has(section.verdict)) {
    fail(`${name}.verdict is "${section.verdict}", not a recognized verdict value.`);
  } else {
    if (typeof section.verdictReason !== "string" || section.verdictReason.trim().length < 20) {
      fail(`${name}.verdictReason is missing or too short (< 20 chars) to be a real explanation -- verdict "${section.verdict}" is not adequately justified.`);
    } else {
      ok(`${name}: verdict="${section.verdict}", reason recorded (${section.verdictReason.length} chars).`);
    }

    if (section.verdict === "PENDING-SCOPE") {
      // A PENDING-SCOPE verdict must still be backed by real evidence of
      // WHY it's pending (an actual probe/check that was run and came back
      // negative), not just an assertion.
      const hasEvidence = requiredEvidenceKeys.some((key) => {
        const value = getNested(section, key);
        return value !== undefined && value !== null;
      });
      if (!hasEvidence) {
        fail(`${name} verdict is PENDING-SCOPE but none of the expected evidence keys (${requiredEvidenceKeys.join(", ")}) are present -- the pending status is not backed by a real check.`);
      } else {
        ok(`${name}: PENDING-SCOPE is backed by real recorded evidence.`);
      }
    }
  }
}

function getNested(obj, dottedKey) {
  return dottedKey.split(".").reduce((acc, k) => (acc && typeof acc === "object" ? acc[k] : undefined), obj);
}

// --- Resend -------------------------------------------------------------------

checkSection("resend", data.resend, ["dryRun.result", "liveDeliveryTest", "configured"]);

if (data.resend) {
  if (data.resend.dryRun?.result === undefined) {
    fail(`resend.dryRun.result is missing -- no real dry-run of the actual sendEmail() code path was captured.`);
  } else {
    const r = data.resend.dryRun.result;
    const looksReal =
      typeof r === "object" &&
      ("success" in r || "threw" in r) &&
      (typeof r.error === "string" || r.success === true || r.threw === true);
    if (!looksReal) {
      fail(`resend.dryRun.result does not look like a real sendEmail() return value (expected a success/error or threw/error shape).`);
    } else {
      ok(`resend.dryRun.result is a real captured sendEmail() return value: ${JSON.stringify(r)}.`);
    }
  }

  if (typeof data.resend.configured !== "boolean") {
    fail(`resend.configured is not a boolean -- key-presence check across environments was not recorded.`);
  }
}

// --- Stripe ---------------------------------------------------------------

checkSection("stripe", data.stripe, ["webhookSignatureFunctionalTest.results", "checkoutLiveTest", "configured"]);

if (data.stripe) {
  const sigTest = data.stripe.webhookSignatureFunctionalTest;
  if (!sigTest || typeof sigTest !== "object") {
    fail(`stripe.webhookSignatureFunctionalTest is missing -- webhook signature handling was not verified by reading the code, as required at minimum.`);
  } else {
    const r = sigTest.results;
    if (!r || !r.validSignature || !r.tamperedPayload || !r.wrongSecret) {
      fail(`stripe.webhookSignatureFunctionalTest.results is missing one or more of validSignature/tamperedPayload/wrongSecret -- signature handling was not actually exercised.`);
    } else {
      if (r.validSignature.pass !== true) {
        fail(`stripe webhook signature test: a validly-signed test payload did NOT verify (validSignature.pass !== true). This is a broken-signature-handling finding per the task's own instruction.`);
      } else {
        ok(`stripe: a real, validly-signed test webhook payload was accepted by the actual constructEvent() call.`);
      }
      if (r.tamperedPayload.pass !== true) {
        fail(`stripe webhook signature test: a tampered payload was NOT rejected (tamperedPayload.pass !== true). This is a broken-signature-handling finding.`);
      } else {
        ok(`stripe: a tampered payload was correctly rejected by constructEvent().`);
      }
      if (r.wrongSecret.pass !== true) {
        fail(`stripe webhook signature test: a signature verified against the wrong secret was NOT rejected (wrongSecret.pass !== true). This is a broken-signature-handling finding.`);
      } else {
        ok(`stripe: a signature checked against the wrong secret was correctly rejected.`);
      }
    }

    if (sigTest.pass !== true) {
      fail(`stripe.webhookSignatureFunctionalTest.pass is not true -- the aggregate signature verification test failed.`);
    }
  }

  if (data.stripe.webhookRouteCodeRead && data.stripe.webhookRouteCodeRead.exists === true) {
    if (data.stripe.webhookRouteCodeRead.allChecksPass !== true) {
      fail(`stripe.webhookRouteCodeRead.allChecksPass is not true -- the webhook route's own fail-closed/idempotency checks did not all pass on a direct code read.`);
    } else {
      ok(`stripe: webhook route code-read confirms fail-closed behavior on missing secret/signature, idempotency, and raw-body handling.`);
    }
  } else {
    fail(`stripe.webhookRouteCodeRead is missing or the webhook route file was not found -- item 2's "confirm the webhook signature-verification code path exists and is correct by reading it" requirement is not satisfied.`);
  }

  if (typeof data.stripe.configured !== "boolean") {
    fail(`stripe.configured is not a boolean -- key-presence check across environments was not recorded.`);
  }
}

// --- Google Calendar --------------------------------------------------------

checkSection("googleCalendar", data.googleCalendar, [
  "oauthClientConstructionDryRun.result",
  "connectedAccountsQuery",
  "oauthAppConfigured",
]);

if (data.googleCalendar) {
  if (!data.googleCalendar.connectedAccountsQuery || typeof data.googleCalendar.connectedAccountsQuery.totalRowsFound !== "number") {
    fail(`googleCalendar.connectedAccountsQuery.totalRowsFound is missing -- no real live query of the integrations table was recorded (item 3 requires checking whether a connected account exists).`);
  } else {
    ok(`googleCalendar: real live query of the integrations table (provider='google') recorded -- ${data.googleCalendar.connectedAccountsQuery.totalRowsFound} row(s) found, ${data.googleCalendar.connectedAccountsQuery.activeWithTokenCount ?? 0} active with a token.`);
  }

  if (typeof data.googleCalendar.hasConnectedAccount !== "boolean") {
    fail(`googleCalendar.hasConnectedAccount is not a boolean.`);
  }

  if (typeof data.googleCalendar.oauthAppConfigured !== "boolean") {
    fail(`googleCalendar.oauthAppConfigured is not a boolean -- OAuth env-var presence check was not recorded.`);
  }

  // If a connected account genuinely exists and the OAuth app is configured,
  // this verifier requires the verdict to NOT be a bare PENDING-SCOPE with no
  // live-read attempt recorded -- that combination would mean a real probe
  // was skippable but wasn't attempted or explained.
  if (data.googleCalendar.oauthAppConfigured === true && data.googleCalendar.hasConnectedAccount === true) {
    if (data.googleCalendar.verdict === "PENDING-SCOPE" && !data.googleCalendar.liveReadProbe?.reason) {
      fail(`googleCalendar: OAuth app is configured AND a connected account exists, but verdict is PENDING-SCOPE with no liveReadProbe.reason explaining why a live read wasn't performed.`);
    }
  }
}

// --- Cross-cutting: findings array present and well-formed -----------------

if (!Array.isArray(data.findings)) {
  fail(`data.findings is not an array.`);
} else {
  ok(`data.findings is an array with ${data.findings.length} entrie(s).`);
  for (const f of data.findings) {
    if (!f || typeof f.severity !== "string" || typeof f.description !== "string" || f.description.trim().length === 0) {
      fail(`data.findings contains a malformed entry (missing severity or description): ${JSON.stringify(f)}`);
    }
  }
}

// --- Summary consistency -----------------------------------------------------

if (!data.summary) {
  fail(`data.summary is missing.`);
} else {
  const expectedKeys = ["resend_verdict", "stripe_verdict", "googleCalendar_verdict"];
  for (const k of expectedKeys) {
    if (typeof data.summary[k] !== "string") {
      fail(`data.summary.${k} is missing or not a string.`);
    } else {
      const sectionName = k.replace("_verdict", "");
      const sectionKey = sectionName === "resend" ? "resend" : sectionName === "stripe" ? "stripe" : "googleCalendar";
      if (data[sectionKey] && data.summary[k] !== data[sectionKey].verdict) {
        fail(`data.summary.${k} ("${data.summary[k]}") does not match data.${sectionKey}.verdict ("${data[sectionKey].verdict}") -- inconsistent evidence.`);
      }
    }
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(
  `\nPASS: ${STATE_FILE} records a real result (or an explicit, evidence-backed PENDING-SCOPE) for ` +
    `Resend, Stripe, and Google Calendar, and the Stripe webhook signature-verification functional test ` +
    `(valid/tampered/wrong-secret) all passed.`,
);
process.exit(0);
