// PT-02-004 verifier: confirms test-evidence/pt-02/crud-cycles.json covers the resource set this
// task selected (the 8 named example resources -- applications, opportunities, drafts, pipeline
// items [draft_queue], contacts, donor-discovery prospects, grant_budgets, deadlines -- plus the
// 3 additional full-CRUD breadth resources pt02-004-crud-cycles.mjs added: request_profiles,
// email_templates, email_sequences), that each resource carries all four CRUD steps
// (create/read/update/delete) with a recorded outcome and status, and that every "tested" step
// carries a numeric status and a real, recognized outcome. Exits 0 only if all checks pass; exits
// 1 with a printed reason on any failure.
// ASCII only. Node 20 compatible.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");

const crudPath = path.join(repoRoot, "test-evidence", "pt-02", "crud-cycles.json");

// The full resource set this task's own script (pt02-004-crud-cycles.mjs) selects, per its own
// header comment -- the 8 named example resources this task listed, mapped onto real API surfaces
// where one exists (and explicitly recorded as a zero-route finding where none does), plus 3
// additional full-CRUD resources added for breadth/positive-control coverage.
const EXPECTED_RESOURCES = new Set([
  "draft_queue", // "pipeline items"
  "request_profiles", // additional
  "email_templates", // additional
  "email_sequences", // additional
  "grant_budgets",
  "applications",
  "drafts",
  "donor_discovery_prospects",
  "opportunities",
  "contacts",
  "deadlines",
]);

const REQUIRED_STEP_KEYS = ["create", "read", "update", "delete"];
const VALID_OUTCOMES = new Set(["tested", "no_route", "skipped_prereq_failed"]);

function fail(reason) {
  console.error(`PT-02-004 FAIL: ${reason}`);
  process.exit(1);
}

function main() {
  let doc;
  try {
    doc = assertJsonFileHasKey(crudPath, "resources");
  } catch (err) {
    fail(`crud-cycles.json check failed: ${err.message}`);
    return;
  }

  if (!Array.isArray(doc.resources) || doc.resources.length === 0) {
    fail(`resources[] in crud-cycles.json is missing, not an array, or empty`);
    return;
  }

  // 1. Coverage: every resource this task selected must have a row (nothing silently dropped),
  //    and no unexplained extra rows sneak the count up without being real.
  const presentResources = new Set(doc.resources.map((r) => r && r.resource));
  const missing = [...EXPECTED_RESOURCES].filter((r) => !presentResources.has(r));
  if (missing.length > 0) {
    fail(`${missing.length} selected resource(s) have no row in crud-cycles.json: ${missing.join(", ")}`);
    return;
  }
  const unexpected = [...presentResources].filter((r) => !EXPECTED_RESOURCES.has(r));
  if (unexpected.length > 0) {
    fail(
      `${unexpected.length} resource row(s) in crud-cycles.json are not in this task's expected ` +
        `selection (update EXPECTED_RESOURCES in this verifier if the selection was deliberately ` +
        `changed): ${unexpected.join(", ")}`,
    );
    return;
  }

  // 2. Each resource: real label, real steps object, all four required CRUD step keys present.
  for (const r of doc.resources) {
    if (!r || typeof r.resource !== "string" || r.resource.trim() === "") {
      fail(`a resource row is missing a "resource" key entirely: ${JSON.stringify(r).slice(0, 200)}`);
      return;
    }
    if (typeof r.label !== "string" || r.label.trim() === "") {
      fail(`resource "${r.resource}" has no "label"`);
      return;
    }
    if (!r.steps || typeof r.steps !== "object") {
      fail(`resource "${r.resource}" has no "steps" object`);
      return;
    }
    const missingSteps = REQUIRED_STEP_KEYS.filter((k) => !(k in r.steps));
    if (missingSteps.length > 0) {
      fail(`resource "${r.resource}" is missing required CRUD step(s): ${missingSteps.join(", ")}`);
      return;
    }
    if (!("readAfterDelete" in r.steps)) {
      fail(`resource "${r.resource}" is missing the "readAfterDelete" step (the DELETE-then-GET-404 assertion)`);
      return;
    }

    for (const stepKey of [...REQUIRED_STEP_KEYS, "readAfterDelete"]) {
      const step = r.steps[stepKey];
      if (!step || typeof step !== "object") {
        fail(`resource "${r.resource}" step "${stepKey}" is not an object`);
        return;
      }
      if (typeof step.route !== "string" || step.route.trim() === "") {
        fail(`resource "${r.resource}" step "${stepKey}" has no "route"`);
        return;
      }
      if (!VALID_OUTCOMES.has(step.outcome)) {
        fail(
          `resource "${r.resource}" step "${stepKey}" has an unrecognized outcome: ${JSON.stringify(step.outcome)}`,
        );
        return;
      }
      if (!("status" in step)) {
        fail(`resource "${r.resource}" step "${stepKey}" has no "status" key (must be present, numeric or null)`);
        return;
      }
      if (step.outcome === "tested" && typeof step.status !== "number") {
        fail(
          `resource "${r.resource}" step "${stepKey}" has outcome "tested" but a non-numeric status ` +
            `(${JSON.stringify(step.status)}) -- a tested step must record a real HTTP status`,
        );
        return;
      }
      if (step.outcome !== "tested" && typeof step.notes !== "string") {
        fail(
          `resource "${r.resource}" step "${stepKey}" has outcome "${step.outcome}" but no explanatory "notes" ` +
            `string -- a no_route/skipped step must say why`,
        );
        return;
      }
    }

    // 3. Any mutation step (create/update/delete) that was actually tested via a real route must
    //    carry a viewerWriteAttempt sub-check (this task's step 2: viewer-role WRITE rejected on
    //    each real mutation route), with an explicit refused boolean.
    for (const stepKey of ["create", "update", "delete"]) {
      const step = r.steps[stepKey];
      if (step.outcome !== "tested") continue;
      const vw = step.viewerWriteAttempt;
      if (!vw || typeof vw !== "object" || typeof vw.refused !== "boolean") {
        fail(
          `resource "${r.resource}" step "${stepKey}" was tested via a real route but has no ` +
            `viewerWriteAttempt.refused boolean -- the viewer-role write-rejection check is missing`,
        );
        return;
      }
    }

    if (typeof r.verdict !== "string" || (r.verdict !== "PASS" && r.verdict !== "FINDING")) {
      fail(`resource "${r.resource}" has no recognized aggregate "verdict" (PASS or FINDING)`);
      return;
    }
  }

  // 4. Top-level metadata sanity.
  if (typeof doc.testOrgId !== "string" || doc.testOrgId.trim() === "") {
    fail(`crud-cycles.json has no top-level "testOrgId"`);
    return;
  }
  if (doc.resourceCount !== doc.resources.length) {
    fail(
      `crud-cycles.json's resourceCount (${doc.resourceCount}) does not match the actual ` +
        `resources[] length (${doc.resources.length})`,
    );
    return;
  }

  const findingResources = doc.resources.filter((r) => r.verdict === "FINDING");
  const testedStepCount = doc.resources.reduce(
    (sum, r) => sum + Object.values(r.steps).filter((s) => s.outcome === "tested").length,
    0,
  );
  const noRouteStepCount = doc.resources.reduce(
    (sum, r) => sum + Object.values(r.steps).filter((s) => s.outcome === "no_route").length,
    0,
  );

  console.log(
    `PT-02-004 PASS: crud-cycles.json covers all ${EXPECTED_RESOURCES.size} selected resource(s), ` +
      `each with all four required CRUD steps (create/read/update/delete) plus readAfterDelete, ` +
      `every step carrying a recognized outcome and (when tested) a numeric status. ` +
      `${testedStepCount} step(s) actually exercised via real API calls, ${noRouteStepCount} ` +
      `recorded as no_route findings.` +
      (findingResources.length > 0
        ? ` *** ${findingResources.length} resource(s) with a FINDING verdict: ${findingResources.map((r) => r.resource).join(", ")} -- see crud-cycles.json for detail ***`
        : " No resource carries a FINDING verdict beyond the documented no_route gaps."),
  );
  process.exit(0);
}

main();
