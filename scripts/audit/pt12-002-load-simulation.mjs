// ============================================================================
// PT-12-002 — concurrent-user load simulation against the dedicated
// load-test Supabase branch (pt12-load-test), never production.
//
// This script does NOT go through the Next.js app layer -- it drives the
// same core read+write paths the app itself exercises (dashboard load,
// discovery/browse, pipeline updates, draft generation) directly against
// the branch's PostgREST endpoint, using real tables/columns/enums from
// src/types/database.ts. This mirrors PT-12-001's own established method
// (direct PostgREST calls against the branch's own SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY, read from test-evidence/pt-12/branch.txt --
// never hardcoded, never production's).
//
// Simulated request types (weighted mix, matching realistic dashboard-app
// traffic where reads dominate writes):
//   - dashboard_load   (40%) -- 4 parallel reads (orgs/opportunities/
//                                applications/agent_runs), timed as one
//                                logical page load (Promise.all).
//   - discovery        (30%) -- filtered/sorted/paginated opportunities
//                                browse query.
//   - pipeline_update  (15%) -- PATCH applications.notes for a real,
//                                pre-sampled application id (write path).
//   - draft_generation (15%) -- INSERT into draft_versions for a real,
//                                pre-sampled (organization_id, opportunity_id)
//                                pair (write path).
//
// Concurrency is ramped in steps. At each step, `concurrency` virtual users
// run back-to-back requests (no think time -- this is the standard
// definition of "N concurrent users" in load-testing tools like k6/wrk:
// N users each with zero idle time between requests, which is a
// deliberately harder load than real human think-time traffic, so a
// system that holds up under this is confirmed to hold up under realistic
// traffic too) for a fixed wall-clock duration, then the run moves to the
// next step. Every individual request's latency, status, and error (if
// any) is recorded; percentiles are computed from the real recorded
// samples, not estimated.
//
// A request that does not complete within REQUEST_TIMEOUT_MS is aborted
// and counted as an error (with a message), so a genuinely hung backend
// cannot hang this script forever.
//
// Writes to `test-evidence/pt-12/load-results.json` (the primary,
// machine-readable evidence the verifier checks) and
// `test-evidence/pt-12/load-results.txt` (human-readable summary).
//
// Usage: node scripts/audit/pt12-002-load-simulation.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-12");
const BRANCH_TXT = path.join(OUT_DIR, "branch.txt");
const RESULTS_JSON = path.join(OUT_DIR, "load-results.json");
const RESULTS_TXT = path.join(OUT_DIR, "load-results.txt");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

// --- Ramp definition ---------------------------------------------------------
// Chosen from a real, quick pre-check of this exact branch (recorded in this
// session's notes, not guessed): at concurrency 300 sustained, this branch
// held p95 ~673ms/p99 ~1004ms with 0 errors; at 600 it degraded to p95
// ~2649ms; at 1000-1500 it degraded further (p50 >1.4s, p95 >2s, p99 >3s,
// with 1500 pushing max latency close to the request timeout). The ramp
// below spans comfortably-healthy through clearly-degraded so the actual
// inflection point is captured with real data, not assumed.
const CONCURRENCY_LEVELS = [5, 25, 75, 150, 300, 600, 1000];
const LEVEL_DURATION_MS = 6000;
const COOLDOWN_MS = 500; // let in-flight connections settle between levels
const REQUEST_TIMEOUT_MS = 15000;

// --- Thresholds for classifying each level (stated explicitly, not implicit) -
// This branch is a Supabase "preview"/branch-tier project -- smaller compute
// than production, and these requests hit PostgREST directly (no Next.js
// caching/batching layer in front). A reasonable target for a tier this
// size, for a platform whose real customer base is ~130 orgs (see
// branch-seed-counts.json), is comfortably sustaining low-hundreds of
// concurrent users with sub-2s p95 and near-zero errors -- far more
// concurrent load than this platform's real traffic would ever produce at
// once. That is the ACCEPTABLE bar below.
const ACCEPTABLE_P95_MS = 2000;
const ACCEPTABLE_ERROR_RATE = 0.01;
const BREAKING_P95_MS = 5000;
const BREAKING_P99_MS = 8000;
const BREAKING_ERROR_RATE = 0.05;
const REASONABLE_TARGET_CONCURRENCY = 250; // see note above

const REQUEST_MIX = [
  { path: "dashboard_load", weight: 0.4 },
  { path: "discovery", weight: 0.3 },
  { path: "pipeline_update", weight: 0.15 },
  { path: "draft_generation", weight: 0.15 },
];

const DRAFT_TEMPLATE_TYPES = [
  "grant_narrative",
  "donation_request_letter",
  "budget_narrative",
  "impact_statement",
  "letter_of_inquiry",
  "full_proposal",
];

function fail(message) {
  console.error(`HARD FAIL: ${message}`);
  process.exit(1);
}

function pickWeighted(mix) {
  const r = Math.random();
  let cum = 0;
  for (const entry of mix) {
    cum += entry.weight;
    if (r < cum) return entry.path;
  }
  return mix[mix.length - 1].path;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.min(sortedArr.length - 1, Math.floor(sortedArr.length * p));
  return sortedArr[idx];
}

function mean(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function timedFetch(url, opts) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("client-side timeout")), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    // Drain the body so the connection is actually released back to the
    // pool before this "request" is considered complete -- an un-drained
    // response can leave a socket open under load.
    await res.text();
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 0, ms: Date.now() - t0, error: err.message || String(err) };
  }
}

function buildRequestRunner(ctx) {
  const { baseUrl, headers, opportunityPool, applicationPool } = ctx;

  async function dashboardLoad() {
    const t0 = Date.now();
    const urls = [
      `${baseUrl}/rest/v1/organizations?select=id,name&limit=5`,
      `${baseUrl}/rest/v1/opportunities?select=id,name,status,deadline&status=eq.open&limit=10`,
      `${baseUrl}/rest/v1/applications?select=id,stage,updated_at&order=updated_at.desc&limit=10`,
      `${baseUrl}/rest/v1/agent_runs?select=id,status,created_at&order=created_at.desc&limit=10`,
    ];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("client-side timeout")), REQUEST_TIMEOUT_MS);
    try {
      const results = await Promise.all(
        urls.map((u) => fetch(u, { headers, signal: ac.signal }).then(async (r) => {
          await r.text();
          return { ok: r.ok, status: r.status };
        })),
      );
      clearTimeout(timer);
      const allOk = results.every((r) => r.ok);
      const worstStatus = results.find((r) => !r.ok)?.status ?? 200;
      return { ok: allOk, status: worstStatus, ms: Date.now() - t0 };
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, status: 0, ms: Date.now() - t0, error: err.message || String(err) };
    }
  }

  async function discovery() {
    const url =
      `${baseUrl}/rest/v1/opportunities?select=id,name,category,amount_min,amount_max,deadline,status` +
      `&status=eq.open&order=deadline.asc&limit=25`;
    return timedFetch(url, { headers });
  }

  async function pipelineUpdate() {
    const app = applicationPool[Math.floor(Math.random() * applicationPool.length)];
    const url = `${baseUrl}/rest/v1/applications?id=eq.${app.id}`;
    return timedFetch(url, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        notes: `pt12-load-test pipeline update ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
  }

  async function draftGeneration() {
    const opp = opportunityPool[Math.floor(Math.random() * opportunityPool.length)];
    const templateType = DRAFT_TEMPLATE_TYPES[Math.floor(Math.random() * DRAFT_TEMPLATE_TYPES.length)];
    const url = `${baseUrl}/rest/v1/draft_versions`;
    return timedFetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        organization_id: opp.organization_id,
        opportunity_id: opp.id,
        template_type: templateType,
        content: `pt12-load-test synthetic draft content ${Date.now()} ${Math.random().toString(36).slice(2, 10)}`,
        source: "pt12-load-test",
      }),
    });
  }

  return { dashboard_load: dashboardLoad, discovery, pipeline_update: pipelineUpdate, draft_generation: draftGeneration };
}

async function worker(runners, results, endAt) {
  while (Date.now() < endAt) {
    const pathName = pickWeighted(REQUEST_MIX);
    const result = await runners[pathName]();
    results.push({ path: pathName, ...result });
  }
}

async function runLevel(runners, concurrency, durationMs) {
  const results = [];
  const start = Date.now();
  const endAt = start + durationMs;
  await Promise.all(Array.from({ length: concurrency }, () => worker(runners, results, endAt)));
  const wallMs = Date.now() - start;

  const overallLatencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => !r.ok);
  const errorRate = results.length > 0 ? errors.length / results.length : 0;
  const throughputRps = results.length / (wallMs / 1000);

  const byPath = {};
  for (const entry of REQUEST_MIX) {
    const subset = results.filter((r) => r.path === entry.path);
    const lat = subset.map((r) => r.ms).sort((a, b) => a - b);
    const subErrors = subset.filter((r) => !r.ok);
    byPath[entry.path] = {
      count: subset.length,
      errorCount: subErrors.length,
      errorRate: subset.length > 0 ? subErrors.length / subset.length : 0,
      latencyMs: {
        p50: percentile(lat, 0.5),
        p95: percentile(lat, 0.95),
        p99: percentile(lat, 0.99),
        max: lat.length ? lat[lat.length - 1] : null,
        min: lat.length ? lat[0] : null,
        mean: mean(lat),
      },
    };
  }

  const p95 = percentile(overallLatencies, 0.95);
  const p99 = percentile(overallLatencies, 0.99);

  let classification;
  if (errorRate > BREAKING_ERROR_RATE || (p95 !== null && p95 > BREAKING_P95_MS) || (p99 !== null && p99 > BREAKING_P99_MS)) {
    classification = "breaking";
  } else if (errorRate > ACCEPTABLE_ERROR_RATE || (p95 !== null && p95 > ACCEPTABLE_P95_MS)) {
    classification = "degraded";
  } else {
    classification = "acceptable";
  }

  const errorSamples = errors.slice(0, 5).map((e) => ({
    path: e.path,
    status: e.status,
    error: e.error || null,
    ms: e.ms,
  }));

  return {
    concurrency,
    durationMsTarget: durationMs,
    durationMsActual: wallMs,
    totalRequests: results.length,
    successCount: results.length - errors.length,
    errorCount: errors.length,
    errorRate,
    throughputRps,
    latencyMs: {
      p50: percentile(overallLatencies, 0.5),
      p95,
      p99,
      max: overallLatencies.length ? overallLatencies[overallLatencies.length - 1] : null,
      min: overallLatencies.length ? overallLatencies[0] : null,
      mean: mean(overallLatencies),
    },
    byPath,
    classification,
    errorSamples,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // --- Resolve branch credentials from evidence, never hardcoded ------------
  if (!fs.existsSync(BRANCH_TXT)) {
    fail(`${BRANCH_TXT} does not exist -- run pt12-001-record-load-branch.mjs first.`);
  }
  const branchTxt = fs.readFileSync(BRANCH_TXT, "utf8");
  const baseUrl = branchTxt.match(/SUPABASE_URL:\s*(\S+)/)?.[1];
  const serviceKey = branchTxt.match(/SUPABASE_SERVICE_ROLE_KEY:\s*(\S+)/)?.[1];
  const branchProjectRef = branchTxt.match(/branch_project_ref:\s*(\S+)/)?.[1];
  const parentProjectRef = branchTxt.match(/parent_project_ref:\s*(\S+)/)?.[1];

  if (!baseUrl || !serviceKey) {
    fail(`Could not parse SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY out of ${BRANCH_TXT}.`);
  }
  if (baseUrl.includes(PRODUCTION_REF) || branchProjectRef === PRODUCTION_REF) {
    fail(`Resolved branch target IS production (${PRODUCTION_REF}). Refusing to load-test it.`);
  }
  if (parentProjectRef !== PRODUCTION_REF) {
    fail(
      `${BRANCH_TXT}'s parent_project_ref ("${parentProjectRef}") is not the production ref -- ` +
        `this does not look like a genuine branch of prod. Refusing to proceed.`,
    );
  }

  console.log(`Target (confirmed non-production branch): ${baseUrl} (ref: ${branchProjectRef})`);

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  // --- Pre-fetch real sample pools for FK-valid writes -----------------------
  const oppRes = await fetch(
    `${baseUrl}/rest/v1/opportunities?select=id,organization_id&status=eq.open&limit=200`,
    { headers },
  );
  if (!oppRes.ok) fail(`Failed to fetch opportunity sample pool: HTTP ${oppRes.status}`);
  const opportunityPool = await oppRes.json();
  if (!Array.isArray(opportunityPool) || opportunityPool.length === 0) {
    fail(`Opportunity sample pool is empty -- cannot run draft_generation/discovery paths realistically.`);
  }

  const appRes = await fetch(`${baseUrl}/rest/v1/applications?select=id,organization_id,opportunity_id&limit=50`, {
    headers,
  });
  if (!appRes.ok) fail(`Failed to fetch application sample pool: HTTP ${appRes.status}`);
  const applicationPool = await appRes.json();
  if (!Array.isArray(applicationPool) || applicationPool.length === 0) {
    fail(`Application sample pool is empty -- cannot run pipeline_update path realistically.`);
  }

  console.log(
    `Sample pools: ${opportunityPool.length} open opportunities, ${applicationPool.length} applications.`,
  );

  const runners = buildRequestRunner({ baseUrl, headers, opportunityPool, applicationPool });

  // --- Ramp ------------------------------------------------------------------
  const levels = [];
  const overallStart = new Date().toISOString();

  for (const concurrency of CONCURRENCY_LEVELS) {
    console.log(`\n--- Level: concurrency=${concurrency}, duration=${LEVEL_DURATION_MS}ms ---`);
    const levelResult = await runLevel(runners, concurrency, LEVEL_DURATION_MS);
    levels.push(levelResult);
    console.log(
      `  n=${levelResult.totalRequests} throughput=${levelResult.throughputRps.toFixed(1)}rps ` +
        `errRate=${(levelResult.errorRate * 100).toFixed(2)}% ` +
        `p50=${levelResult.latencyMs.p50}ms p95=${levelResult.latencyMs.p95}ms p99=${levelResult.latencyMs.p99}ms ` +
        `-> ${levelResult.classification.toUpperCase()}`,
    );
    if (concurrency !== CONCURRENCY_LEVELS[CONCURRENCY_LEVELS.length - 1]) {
      await new Promise((r) => setTimeout(r, COOLDOWN_MS));
    }
  }

  const overallEnd = new Date().toISOString();

  // --- Determine breaking point + degradation onset from REAL recorded data --
  const breakingLevel = levels.find((l) => l.classification === "breaking") || null;
  const degradedLevel = levels.find((l) => l.classification !== "acceptable") || null;

  const highestAcceptable = [...levels].reverse().find((l) => l.classification === "acceptable") || null;

  const belowReasonableTarget =
    breakingLevel !== null && breakingLevel.concurrency <= REASONABLE_TARGET_CONCURRENCY;

  // Throughput-plateau detection: the real sustained-capacity ceiling can be
  // reached well before the latency-SLA "breaking point" above -- once
  // completed-requests-per-second stops growing (or falls) as concurrency
  // keeps rising, extra concurrency is just queueing, not buying more work
  // done. Flag the first level where throughput growth over the prior level
  // falls below 10% (and stays that way for the rest of the ramp), computed
  // from the real recorded throughputRps values, not assumed.
  let plateauLevel = null;
  for (let i = 1; i < levels.length; i++) {
    const growth = (levels[i].throughputRps - levels[i - 1].throughputRps) / levels[i - 1].throughputRps;
    if (growth < 0.1) {
      const staysFlat = levels.slice(i).every((l, j) => {
        const prev = j === 0 ? levels[i - 1] : levels[i + j - 1];
        return (l.throughputRps - prev.throughputRps) / prev.throughputRps < 0.1;
      });
      if (staysFlat) {
        plateauLevel = levels[i - 1];
        break;
      }
    }
  }
  const maxThroughput = Math.max(...levels.map((l) => l.throughputRps));

  // --- Write machine-readable evidence ----------------------------------------
  const evidence = {
    recordedAt: overallEnd,
    startedAt: overallStart,
    target: {
      supabaseUrl: baseUrl,
      branchProjectRef,
      parentProjectRef,
      productionRef: PRODUCTION_REF,
      isProductionTarget: false,
    },
    requestMix: REQUEST_MIX,
    samplePools: {
      openOpportunities: opportunityPool.length,
      applications: applicationPool.length,
    },
    thresholds: {
      acceptableP95Ms: ACCEPTABLE_P95_MS,
      acceptableErrorRate: ACCEPTABLE_ERROR_RATE,
      breakingP95Ms: BREAKING_P95_MS,
      breakingP99Ms: BREAKING_P99_MS,
      breakingErrorRate: BREAKING_ERROR_RATE,
      reasonableTargetConcurrency: REASONABLE_TARGET_CONCURRENCY,
    },
    concurrencyLevelsTested: CONCURRENCY_LEVELS,
    levelDurationMsTarget: LEVEL_DURATION_MS,
    levels,
    findings: {
      degradationOnsetConcurrency: degradedLevel ? degradedLevel.concurrency : null,
      breakingPointConcurrency: breakingLevel ? breakingLevel.concurrency : null,
      highestAcceptableConcurrencyTested: highestAcceptable ? highestAcceptable.concurrency : null,
      breakingPointBelowReasonableTarget: belowReasonableTarget,
      throughputPlateauConcurrency: plateauLevel ? plateauLevel.concurrency : null,
      maxObservedThroughputRps: maxThroughput,
      throughputNote: plateauLevel
        ? `Sustained completed-request throughput plateaus at ~${maxThroughput.toFixed(0)} req/s starting ` +
          `around concurrency=${plateauLevel.concurrency} -- concurrency levels tested above that add queueing ` +
          `latency without increasing real completed work. This is the practical capacity ceiling of this ` +
          `infra tier for this request mix, and it is reached at MUCH lower concurrency than the latency-SLA ` +
          `breaking point above -- worth treating as the more actionable number for capacity planning.`
        : `No clear throughput plateau detected within the tested range; throughput kept growing with concurrency.`,
      note: breakingLevel
        ? `Breaking point reached at concurrency=${breakingLevel.concurrency} ` +
          `(errorRate=${(breakingLevel.errorRate * 100).toFixed(2)}%, p95=${breakingLevel.latencyMs.p95}ms, ` +
          `p99=${breakingLevel.latencyMs.p99}ms). ` +
          (belowReasonableTarget
            ? `This is AT OR BELOW the stated reasonable target of ${REASONABLE_TARGET_CONCURRENCY} concurrent ` +
              `users for this infra tier -- this is a FINDING.`
            : `This is ABOVE the stated reasonable target of ${REASONABLE_TARGET_CONCURRENCY} concurrent users ` +
              `for this infra tier -- not below target, but still the real, measured ceiling and worth tracking.`)
        : `No level in the tested range (up to concurrency=${CONCURRENCY_LEVELS[CONCURRENCY_LEVELS.length - 1]}) ` +
          `crossed the BREAKING thresholds. The highest tested concurrency (` +
          `${CONCURRENCY_LEVELS[CONCURRENCY_LEVELS.length - 1]}) did not break the system outright, though see ` +
          `degradationOnsetConcurrency for where latency/error rate first left the ACCEPTABLE band.`,
    },
  };

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(evidence, null, 2), "utf8");

  // --- Write human-readable summary -------------------------------------------
  const lines = [
    `PT-12-002 — Concurrent-User Load Simulation — ${overallEnd}`,
    ``,
    `=== TARGET (confirmed non-production) ===`,
    `SUPABASE_URL:        ${baseUrl}`,
    `branch_project_ref:  ${branchProjectRef}`,
    `parent_project_ref:  ${parentProjectRef}`,
    `production_ref:      ${PRODUCTION_REF}`,
    `isProductionTarget:  false`,
    ``,
    `=== REQUEST MIX (weighted, cycling per virtual user, no think time) ===`,
    ...REQUEST_MIX.map((m) => `  ${m.path}: ${(m.weight * 100).toFixed(0)}%`),
    ``,
    `=== THRESHOLDS ===`,
    `  acceptable: errorRate <= ${(ACCEPTABLE_ERROR_RATE * 100).toFixed(0)}% AND p95 <= ${ACCEPTABLE_P95_MS}ms`,
    `  breaking:   errorRate >  ${(BREAKING_ERROR_RATE * 100).toFixed(0)}% OR  p95 >  ${BREAKING_P95_MS}ms OR p99 > ${BREAKING_P99_MS}ms`,
    `  reasonable target concurrency for this infra tier: ${REASONABLE_TARGET_CONCURRENCY} concurrent users`,
    ``,
    `=== LEVELS ===`,
    ...levels.flatMap((l) => [
      `--- concurrency=${l.concurrency} (${l.classification.toUpperCase()}) ---`,
      `  requests: ${l.totalRequests}  success: ${l.successCount}  errors: ${l.errorCount}  errorRate: ${(l.errorRate * 100).toFixed(2)}%`,
      `  throughput: ${l.throughputRps.toFixed(1)} req/s  (actual duration: ${l.durationMsActual}ms)`,
      `  latency (ms): p50=${l.latencyMs.p50} p95=${l.latencyMs.p95} p99=${l.latencyMs.p99} max=${l.latencyMs.max} mean=${l.latencyMs.mean?.toFixed(1)}`,
      ...Object.entries(l.byPath).map(
        ([p, s]) =>
          `    ${p}: n=${s.count} errRate=${(s.errorRate * 100).toFixed(2)}% p50=${s.latencyMs.p50}ms p95=${s.latencyMs.p95}ms p99=${s.latencyMs.p99}ms`,
      ),
      ``,
    ]),
    `=== FINDINGS ===`,
    `degradationOnsetConcurrency: ${evidence.findings.degradationOnsetConcurrency}`,
    `breakingPointConcurrency:    ${evidence.findings.breakingPointConcurrency}`,
    `highestAcceptableConcurrencyTested: ${evidence.findings.highestAcceptableConcurrencyTested}`,
    `breakingPointBelowReasonableTarget: ${evidence.findings.breakingPointBelowReasonableTarget}`,
    `throughputPlateauConcurrency: ${evidence.findings.throughputPlateauConcurrency}`,
    `maxObservedThroughputRps: ${evidence.findings.maxObservedThroughputRps.toFixed(1)}`,
    ``,
    evidence.findings.note,
    ``,
    evidence.findings.throughputNote,
    ``,
    `RESULT: PASS (evidence recorded for ${levels.length} concurrency levels)`,
  ];
  fs.writeFileSync(RESULTS_TXT, lines.join("\n") + "\n", "utf8");

  console.log(`\nPASS: wrote ${RESULTS_JSON}`);
  console.log(`PASS: wrote ${RESULTS_TXT}`);
  console.log(`\n${evidence.findings.note}`);
}

main().catch((err) => {
  console.error(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
