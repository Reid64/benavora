// ============================================================================
// PT-08-002 verifier — cron registration reconciliation
//
// Confirms test-evidence/pt-08/cron-reconciliation.json is real, non-empty
// evidence that actually performs the reconciliation the task requires: it
// must record all three cron-registration sets (documented, vercel.json,
// worker/scheduler.ts), reconcile them into the required categories
// (documented-but-unregistered, registered-but-undocumented, handlers with
// no schedule entry), and cross-reference the WGR-023 middleware finding.
// Also independently re-derives the two ground-truth sets (vercel.json's
// crons array, and the /api/cron/*/route.ts directory listing) from the
// live repo files and cross-checks them against what the evidence file
// claims, so a stale/hand-edited JSON can't silently drift from reality.
// Exits non-zero on any failure.
//
// Usage: node scripts/audit/verify-pt08-002.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const TARGET = path.join("test-evidence", "pt-08", "cron-reconciliation.json");
const VERCEL_JSON = "vercel.json";
const CRON_ROUTES_DIR = path.join("src", "app", "api", "cron");
const REGISTER = path.join("test-evidence", "_register", "WIRING_GAP_REGISTER.md");

let structuralErrors = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function reportError(message) {
  console.error(`FAIL: ${message}`);
  structuralErrors++;
}

if (!fs.existsSync(TARGET)) {
  fail(`${TARGET} does not exist.`);
}

const raw = fs.readFileSync(TARGET, "utf8");
if (raw.trim().length === 0) {
  fail(`${TARGET} is empty.`);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`${TARGET} is not valid JSON: ${err.message}`);
}

if (!data || typeof data !== "object") {
  fail(`${TARGET} did not parse to an object.`);
}

// --- 1. All three sets must be present and non-empty --------------------

const setA = data.setA_documentedCrons;
if (!setA || !Array.isArray(setA.entries) || setA.entries.length === 0) {
  reportError(`setA_documentedCrons.entries must be a non-empty array (documented crons).`);
}

const setB = data.setB_registeredVercelJson;
if (!setB || !Array.isArray(setB.entries) || setB.entries.length === 0) {
  reportError(`setB_registeredVercelJson.entries must be a non-empty array (vercel.json crons).`);
}

const setC = data.setC_workerSchedulerJobs;
if (!setC || !Array.isArray(setC.entries) || setC.entries.length === 0) {
  reportError(
    `setC_workerSchedulerJobs.entries must be a non-empty array (worker/scheduler.ts jobs).`,
  );
}

const handlers = data.cronApiRouteHandlers;
if (!handlers || !Array.isArray(handlers.entries) || handlers.entries.length === 0) {
  reportError(`cronApiRouteHandlers.entries must be a non-empty array.`);
}

// --- 2. Independently re-derive ground truth from the live repo ---------

if (!fs.existsSync(VERCEL_JSON)) {
  reportError(`${VERCEL_JSON} not found — cannot independently verify setB.`);
} else {
  const vercelConfig = JSON.parse(fs.readFileSync(VERCEL_JSON, "utf8"));
  const realCronPaths = new Set((vercelConfig.crons ?? []).map((c) => c.path));

  if (setB && Array.isArray(setB.entries)) {
    if (realCronPaths.size !== setB.entries.length) {
      reportError(
        `vercel.json currently has ${realCronPaths.size} cron(s), but ${TARGET}'s ` +
          `setB_registeredVercelJson.entries records ${setB.entries.length} — evidence is stale.`,
      );
    }
    for (const entry of setB.entries) {
      if (!realCronPaths.has(entry.path)) {
        reportError(
          `${TARGET} claims "${entry.path}" is registered in vercel.json, but it is not ` +
            `present in the current crons array — evidence is stale.`,
        );
      }
    }
    for (const realPath of realCronPaths) {
      if (!setB.entries.some((e) => e.path === realPath)) {
        reportError(
          `vercel.json currently registers "${realPath}", but ${TARGET}'s ` +
            `setB_registeredVercelJson.entries does not record it — evidence is stale ` +
            `or a real cron was added without updating this reconciliation.`,
        );
      }
    }
  }
}

if (!fs.existsSync(CRON_ROUTES_DIR)) {
  reportError(`${CRON_ROUTES_DIR} not found — cannot independently verify cronApiRouteHandlers.`);
} else {
  const realRouteDirs = fs
    .readdirSync(CRON_ROUTES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `/api/cron/${d.name}`)
    .filter((p) => fs.existsSync(path.join(CRON_ROUTES_DIR, p.split("/").pop(), "route.ts")));

  if (handlers && Array.isArray(handlers.entries)) {
    if (realRouteDirs.length !== handlers.entries.length) {
      reportError(
        `Found ${realRouteDirs.length} real /api/cron/*/route.ts handler(s) on disk, but ` +
          `${TARGET}'s cronApiRouteHandlers.entries records ${handlers.entries.length} — ` +
          `evidence is stale (a route was added or removed without updating this file).`,
      );
    }
    const claimedPaths = new Set(handlers.entries.map((e) => e.path));
    for (const realPath of realRouteDirs) {
      if (!claimedPaths.has(realPath)) {
        reportError(
          `Real handler ${realPath}/route.ts exists on disk but is not recorded in ` +
            `${TARGET}'s cronApiRouteHandlers.entries.`,
        );
      }
    }
    for (const claimed of claimedPaths) {
      if (!realRouteDirs.includes(claimed)) {
        reportError(
          `${TARGET} records handler "${claimed}" but no matching route.ts exists on disk.`,
        );
      }
    }
  }
}

// --- 3. Every handler row must be structurally complete and classified --

const REQUIRED_HANDLER_FIELDS = [
  "path",
  "registeredInVercelJson",
  "invokedByWorkerScheduler",
  "documented",
  "classification",
];

if (handlers && Array.isArray(handlers.entries)) {
  for (const [i, row] of handlers.entries.entries()) {
    const label = row.path ?? `cronApiRouteHandlers.entries[${i}]`;
    for (const field of REQUIRED_HANDLER_FIELDS) {
      if (!(field in row) || row[field] === null || row[field] === undefined) {
        reportError(`${label} is missing required field "${field}".`);
      }
    }
    if (typeof row.classification === "string" && row.classification.trim().length === 0) {
      reportError(`${label}.classification must be a non-empty string.`);
    }
  }
}

// --- 4. Reconciliation object must record all four required categories --

const recon = data.reconciliation;
if (!recon || typeof recon !== "object") {
  reportError(`"reconciliation" object is missing.`);
} else {
  if (!Array.isArray(recon.documentedButUnregistered)) {
    reportError(`reconciliation.documentedButUnregistered must be an array.`);
  } else if (recon.documentedButUnregistered.length === 0) {
    reportError(
      `reconciliation.documentedButUnregistered is empty — this audit found real gaps ` +
        `(e.g. /api/cron/draft-automation), so an empty list here means the reconciliation ` +
        `did not actually run, not that there were no findings.`,
    );
  }

  if (!recon.registeredButUndocumented || typeof recon.registeredButUndocumented !== "object") {
    reportError(`reconciliation.registeredButUndocumented must be an object with a "count" field.`);
  } else if (typeof recon.registeredButUndocumented.count !== "number") {
    reportError(`reconciliation.registeredButUndocumented.count must be a number.`);
  }

  if (
    !recon.handlersWithNoScheduleEntry ||
    !Array.isArray(recon.handlersWithNoScheduleEntry.routes)
  ) {
    reportError(`reconciliation.handlersWithNoScheduleEntry.routes must be an array.`);
  }

  if (!recon.matched || !Array.isArray(recon.matched.routes)) {
    reportError(`reconciliation.matched.routes must be an array.`);
  }
}

// --- 5. Cross-check every documentedButUnregistered entry actually shows --
//        up as unregistered in both setB and the handler rows (internal
//        consistency, not just presence).

if (recon && Array.isArray(recon.documentedButUnregistered) && handlers && Array.isArray(handlers.entries)) {
  for (const finding of recon.documentedButUnregistered) {
    const handlerRow = handlers.entries.find((h) => h.path === finding.route);
    if (!handlerRow) {
      reportError(
        `reconciliation.documentedButUnregistered names "${finding.route}", but no matching ` +
          `row exists in cronApiRouteHandlers.entries.`,
      );
      continue;
    }
    if (handlerRow.registeredInVercelJson === true) {
      reportError(
        `reconciliation.documentedButUnregistered names "${finding.route}" as unregistered, ` +
          `but cronApiRouteHandlers records registeredInVercelJson: true for it — contradiction.`,
      );
    }
  }
}

// --- 6. P1 findings backing a real feature must have a findingId, and ---
//        that finding must actually be filed in the WGR register.

if (recon && Array.isArray(recon.documentedButUnregistered)) {
  const p1RealFeatureFindings = recon.documentedButUnregistered.filter(
    (f) => f.severity === "P1" && f.backsRealFeature === true,
  );
  if (p1RealFeatureFindings.length === 0) {
    reportError(
      `No P1 documented-but-unregistered findings with backsRealFeature:true were recorded — ` +
        `this audit's own evidence (e.g. sales-sends' live "schedule" admin action) should have ` +
        `produced at least one.`,
    );
  }
  for (const f of p1RealFeatureFindings) {
    if (!f.findingId || typeof f.findingId !== "string") {
      reportError(`P1 finding for "${f.route}" has no findingId recorded.`);
      continue;
    }
    if (fs.existsSync(REGISTER)) {
      const registerText = fs.readFileSync(REGISTER, "utf8");
      if (!registerText.includes(`| ${f.findingId} |`)) {
        reportError(
          `Finding "${f.findingId}" (${f.route}) is not present in ${REGISTER} — ` +
            `P1 findings backing a real feature must be filed in the register, per task step 4.`,
        );
      }
    }
  }
}

// --- 7. Middleware cross-check (WGR-023) must be present and reference --
//        real, existing evidence.

const mw = data.middlewareCrossCheck;
if (!mw || typeof mw !== "object") {
  reportError(`"middlewareCrossCheck" object is missing — task step 3 was not performed.`);
} else {
  if (mw.relatedFindingId !== "WGR-023") {
    reportError(
      `middlewareCrossCheck.relatedFindingId should be "WGR-023" (the existing PT-02-002 ` +
        `middleware-redirect finding) — got "${mw.relatedFindingId}".`,
    );
  }
  if (!mw.evidence || !fs.existsSync(mw.evidence)) {
    reportError(
      `middlewareCrossCheck.evidence ("${mw.evidence}") does not point at a file that exists.`,
    );
  }
  if (
    !Array.isArray(mw.perCronRouteStatusLocalDevServer) ||
    mw.perCronRouteStatusLocalDevServer.length === 0
  ) {
    reportError(`middlewareCrossCheck.perCronRouteStatusLocalDevServer must be a non-empty array.`);
  }
  if (!mw.productionDiscrepancy || typeof mw.productionDiscrepancy !== "object") {
    reportError(
      `middlewareCrossCheck.productionDiscrepancy is missing — the unresolved WGR-023/WGR-003 ` +
        `production-vs-local-dev question (401 vs 307) must be explicitly recorded, per task step 3.`,
    );
  }
}

// --- 8. Register file itself must contain the new PT-08-002 findings ----

if (!fs.existsSync(REGISTER)) {
  reportError(`${REGISTER} does not exist.`);
} else {
  const registerText = fs.readFileSync(REGISTER, "utf8");
  const declaredFindingIds = Array.isArray(data.summary?.newRegisterFindingsFiled)
    ? data.summary.newRegisterFindingsFiled
    : [];
  if (declaredFindingIds.length === 0) {
    reportError(`summary.newRegisterFindingsFiled is missing or empty.`);
  }
  for (const id of declaredFindingIds) {
    if (!registerText.includes(`| ${id} |`)) {
      reportError(`summary declares finding "${id}" filed, but it is not present in ${REGISTER}.`);
    }
  }
}

if (structuralErrors > 0) {
  fail(`${structuralErrors} structural/consistency error(s) found in ${TARGET} or its cross-references.`);
}

console.log(`PASS: ${TARGET} is valid and internally consistent.`);
console.log(`  setA (documented): ${setA.entries.length} entries`);
console.log(`  setB (vercel.json): ${setB.entries.length} entries`);
console.log(`  setC (worker/scheduler.ts): ${setC.entries.length} entries`);
console.log(`  cron API route handlers: ${handlers.entries.length}`);
console.log(`  documented-but-unregistered: ${recon.documentedButUnregistered.length}`);
console.log(`  registered-but-undocumented: ${recon.registeredButUndocumented.count}`);
console.log(`  handlers with no schedule entry: ${recon.handlersWithNoScheduleEntry.routes.length}`);
console.log(`  matched (registered + documented): ${recon.matched.routes.length}`);
console.log(
  `  new WGR findings filed: ${(data.summary?.newRegisterFindingsFiled ?? []).join(", ")}`,
);
process.exit(0);
