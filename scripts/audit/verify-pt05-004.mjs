// PT-05-004 verification gate: confirms privileged-access.json records both required
// results with real evidence, not stub placeholders --
//   (a) the demo write-protection result: production-level verification that the real
//       functions/triggers/columns exist, PLUS a live behavioral test (real writes
//       attempted, real rejections captured) with at least one BLOCKED attempt and at
//       least one ALLOWED/negative-control attempt, and an independent re-read
//       confirming no blocked attempt actually mutated anything.
//   (b) the admin impersonation result: a verdict for both "bounded to org" and
//       "audit logged", each backed by real evidence (not just an assertion string).
//
// Exit 0 = all checks pass. Exit 1 = any check fails (prints why).

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EVIDENCE_PATH = path.join(ROOT, "test-evidence", "pt-05", "privileged-access.json");

const failures = [];
const fail = (msg) => failures.push(msg);

function loadJson(p, label) {
  if (!fs.existsSync(p)) {
    fail(`${label} does not exist at ${p}`);
    return null;
  }
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    fail(`${label} could not be read: ${e.message}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`${label} is not valid JSON: ${e.message}`);
    return null;
  }
}

const doc = loadJson(EVIDENCE_PATH, "privileged-access.json");

if (doc) {
  // ---------------------------------------------------------------------
  // (a) Demo write-protection
  // ---------------------------------------------------------------------
  const demo = doc.demo_write_protection;
  if (!demo || typeof demo !== "object") {
    fail("demo_write_protection is missing or not an object");
  } else {
    if (typeof demo.migration !== "string" || !demo.migration.includes("demo_account_scope")) {
      fail("demo_write_protection.migration does not identify the real demo-account-scope migration file");
    }

    const prodCheck = demo.protection_live_in_production;
    if (!prodCheck || typeof prodCheck.verdict !== "string" || prodCheck.verdict.length < 10) {
      fail("demo_write_protection.protection_live_in_production is missing a real verdict string");
    }
    if (!Array.isArray(prodCheck?.triggers_found) || prodCheck.triggers_found.length === 0) {
      fail("demo_write_protection.protection_live_in_production.triggers_found is missing or empty -- no live trigger evidence");
    }

    const pt06 = demo.pt06_unapplied_migration_cross_check;
    if (!pt06 || pt06.checked !== true) {
      fail("demo_write_protection.pt06_unapplied_migration_cross_check was not actually performed (checked !== true)");
    } else if (pt06.found_in_pt06_onDiskNotApplied_bucket === true) {
      fail(
        "PT-06 recorded migration 138_demo_account_scope.sql as UNAPPLIED -- this is a P1 finding per task " +
          "instruction and must be reflected in the findings[] array before this gate can pass",
      );
    }

    const bt = demo.behavioral_test;
    if (!bt || !Array.isArray(bt.attempts) || bt.attempts.length === 0) {
      fail("demo_write_protection.behavioral_test.attempts is missing or empty -- no live write attempts were captured");
    } else {
      const blockedAttempts = bt.attempts.filter((a) => a.expected === "blocked");
      const allowedAttempts = bt.attempts.filter((a) => a.expected === "allowed");
      if (blockedAttempts.length === 0) {
        fail("demo_write_protection.behavioral_test.attempts contains no attempt with expected==='blocked'");
      }
      if (allowedAttempts.length === 0) {
        fail("demo_write_protection.behavioral_test.attempts contains no allowed/negative-control attempt");
      }
      for (const a of bt.attempts) {
        if (typeof a.verdict !== "string" || !a.verdict.startsWith("PASS")) {
          fail(`demo_write_protection.behavioral_test attempt "${a.id}" did not PASS (verdict=${a.verdict}) -- must be reflected as a finding`);
        }
        if (a.expected === "blocked" && a.error_code == null) {
          fail(`demo_write_protection.behavioral_test attempt "${a.id}" expected a blocked write but captured no error_code -- no rejection was actually captured`);
        }
      }
      if (!bt.independent_re_read_after_all_attempts || typeof bt.independent_re_read_after_all_attempts !== "object") {
        fail("demo_write_protection.behavioral_test.independent_re_read_after_all_attempts is missing -- blocked-write verdicts were never independently re-confirmed");
      }
    }
  }

  // ---------------------------------------------------------------------
  // (b) Admin impersonation
  // ---------------------------------------------------------------------
  const imp = doc.admin_impersonation;
  if (!imp || typeof imp !== "object") {
    fail("admin_impersonation is missing or not an object");
  } else {
    const bounded = imp.bounded_to_org;
    if (!bounded || typeof bounded.verdict !== "string" || bounded.verdict.length === 0) {
      fail("admin_impersonation.bounded_to_org is missing a verdict");
    }
    if (!bounded?.cookie_grep?.matches) {
      fail("admin_impersonation.bounded_to_org.cookie_grep.matches is missing -- no real search evidence for the scoping mechanism");
    }
    if (!bounded?.role_gate_is_org_independent) {
      fail("admin_impersonation.bounded_to_org.role_gate_is_org_independent is missing -- no evidence of the actual authorization gate's real behavior");
    }

    const logged = imp.audit_logged;
    if (!logged || typeof logged.verdict !== "string" || logged.verdict.length === 0) {
      fail("admin_impersonation.audit_logged is missing a verdict");
    }
    if (!Array.isArray(logged?.local_reproduction) || logged.local_reproduction.length === 0) {
      fail("admin_impersonation.audit_logged.local_reproduction is missing or empty -- no live reproduction of the route's own audit inserts");
    } else {
      const hasImpersonationLogRow = logged.local_reproduction.some((r) => r.table === "impersonation_log");
      const hasAuditLogsRow = logged.local_reproduction.some((r) => r.table === "audit_logs");
      if (!hasImpersonationLogRow) {
        fail("admin_impersonation.audit_logged.local_reproduction has no entry for the impersonation_log table");
      }
      if (!hasAuditLogsRow) {
        fail("admin_impersonation.audit_logged.local_reproduction has no entry for the audit_logs table");
      }
    }
  }

  // ---------------------------------------------------------------------
  // Findings register consistency: an UNBOUNDED verdict must be P0-registered;
  // any non-FULL audit_logged verdict must be P1-registered (task instruction 3).
  // ---------------------------------------------------------------------
  const findings = Array.isArray(doc.findings) ? doc.findings : [];
  if (imp?.bounded_to_org?.verdict === "UNBOUNDED") {
    const hasP0 = findings.some((f) => f.area === "admin_impersonation" && f.severity === "P0");
    if (!hasP0) {
      fail("bounded_to_org verdict is UNBOUNDED but findings[] contains no P0 admin_impersonation entry (task instruction 3 requires P0 for unbounded impersonation)");
    }
  }
  if (imp?.audit_logged?.verdict && imp.audit_logged.verdict !== "FULL") {
    const hasP1 = findings.some((f) => f.area === "admin_impersonation" && f.severity === "P1");
    if (!hasP1) {
      fail("audit_logged verdict is not FULL but findings[] contains no P1 admin_impersonation entry (task instruction 3 requires P1 for unlogged/partially-logged impersonation)");
    }
  }
}

if (failures.length > 0) {
  console.error(`PT-05-004 verification FAILED (${failures.length} issue(s)):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log("PT-05-004 verification PASSED: privileged-access.json records a real demo write-protection behavioral test and a real admin impersonation scoping+logging test, both with captured evidence.");
process.exit(0);
