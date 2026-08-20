// ============================================================================
// PT-12-003 — Sustained soak + memory-growth (leak) tracking for the real
// Next.js server process AND the real AutoApply worker process, both run
// locally and pointed at the dedicated pt12-load-test Supabase branch (see
// test-evidence/pt-12/branch.txt, created by pt12-001-record-load-branch.mjs)
// — never production.
//
// Unlike PT-12-002 (which drove PostgREST directly, no app processes
// involved), this script boots the ACTUAL processes this audit is about:
//   - `next dev`, spawned directly via `node <next/dist/bin/next> dev -p PORT`
//     (no shell wrapper -- child.pid is the real Next.js process, confirmed
//     live via a smoke test before this script was written), isolated to its
//     own port + build-cache dir (PT_AUDIT_DIST_DIR, the same mechanism
//     next.config.mjs already exposes for PT-10/PT-03), env vars overridden
//     to the branch (never .env.local's production values).
//   - `worker/index.ts`, spawned via `node <tsx/dist/cli.mjs> worker/index.ts`
//     with SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY overridden to the branch.
//     This starts every real worker sub-processor (queue poll, DD-request
//     poll, knowledge indexer, gmail-confirmation-monitor, scheduler,
//     agent-queue processor) exactly as worker/index.ts's own boot sequence
//     does in production.
//
// SAFETY: before starting the worker, this script independently re-queries
// the branch's `submission_queue` and HARD FAILS if any row has
// status='pending' -- that is the one status queueProcessor.dequeue() will
// actually claim and act on (real Playwright browser automation against a
// real external funder portal, a genuine real-world side effect that a DB
// branch does NOT sandbox). A manual pre-check on 2026-08-20 found all 6
// seeded rows already terminal (status IN ('skipped','failed')); this
// in-script re-check makes that safety property self-verifying on every run,
// not just a one-time manual finding. gmail-confirmation-monitor is confirmed
// (via its own documented hasCredentials() gate) to no-op without a refresh
// token, which is not set anywhere reachable here -- so it degrades to a
// harmless per-cycle warning, same as production when unconfigured.
//
// Memory sampling: RSS ("Working Set") of each process's own PID, read via
// `(Get-Process -Id <pid> -ErrorAction SilentlyContinue).WorkingSet64`
// (PowerShell, confirmed working on this machine before this script was
// written). Neither process is expected to spawn OS-level child processes
// under this config (next.config.mjs's `experimental.cpus: 1` already caps
// Next's own worker fan-out to a single process; the worker's sub-processors
// are all in-process async loops, confirmed by reading worker/index.ts) --
// sampling the root PID directly is therefore the real total, not a partial
// view of a process tree.
//
// Load generation: a fixed, moderate number of virtual users continuously
// cycle a weighted mix of real page requests against the local Next server
// for the full sampled window (steady load, not a concurrency ramp -- PT-12-002
// already owns the ramp/breaking-point question; this script's only job is
// "does memory grow over a sustained window"). Mix includes both public
// marketing pages (no auth, exercises rendering) and protected dashboard
// routes hit with no session (exercises middleware's real session-check +
// redirect path, including a real network round-trip to the branch's Auth
// server) -- a request pattern representative of real traffic without
// needing a live authenticated session.
//
// A short, unsampled warmup phase (one real request per unique path, run
// once each before the timed window starts) absorbs Next dev's first-compile
// cost per route (confirmed live: cold /login compile took ~27s) so that
// normal one-time JIT/compile cost isn't misread as "leak" growth in the
// sampled series.
//
// Verdict method (per process, documented explicitly, not implicit):
//   1. Drop the first WARMUP_SAMPLE_FRACTION of the sampled series (default
//      15%) -- a settling window separate from the unsampled compile-warmup
//      above, covering early-run cache/pool fill that is normal and not
//      itself a leak signal.
//   2. growthPercent = (avg of the last quarter of steady-state samples -
//      avg of the first quarter) / (avg of the first quarter). Averaging a
//      window instead of comparing two raw points is deliberate -- reduces
//      false positives/negatives from a single noisy GC-timing sample.
//   3. monotonicityRatio = fraction of consecutive steady-state sample-to-
//      sample deltas that are >= 0 (non-decreasing). A real leak grows
//      steadily (high monotonicity); GC sawtooth noise in a flat process
//      does not (roughly half the deltas negative).
//   4. verdict = "climbing" (leak finding) iff growthPercent exceeds
//      CLIMB_THRESHOLD_PERCENT AND monotonicityRatio exceeds
//      CLIMB_MONOTONICITY_THRESHOLD. Both conditions are required so that
//      neither a single big-but-transient spike (fails monotonicity) nor
//      slow noisy drift with no material growth (fails growthPercent) alone
//      trips a false "climbing" verdict. Otherwise "flat".
//   A "climbing" verdict is reported as a real, positive finding (this
//   script's job is to catch it, not to make it disappear) -- per the task,
//   a confirmed leak is P1: it takes production down over time.
//
// Writes test-evidence/pt-12/soak-memory.json (primary, machine-readable --
// full per-sample series for both processes plus the analysis/verdict) and
// test-evidence/pt-12/soak-memory.txt (human-readable companion, matching
// PT-12-001/002's established convention).
//
// Usage: node scripts/audit/pt12-003-soak-memory.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-12");
const BRANCH_TXT = path.join(OUT_DIR, "branch.txt");
const RESULTS_JSON = path.join(OUT_DIR, "soak-memory.json");
const RESULTS_TXT = path.join(OUT_DIR, "soak-memory.txt");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

const NEXT_PORT = 3413;
const NEXT_DIST_DIR = ".next-pt12-soak";
const WORKER_STREAM_PORT = 8097;
const WORKER_ID = "pt12-soak-worker";

const NEXT_READY_TIMEOUT_MS = 120_000;
const WORKER_SETTLE_MS = 8_000;
const WARMUP_REQUEST_TIMEOUT_MS = 60_000;

const SAMPLE_INTERVAL_MS = 10_000;
const SOAK_DURATION_MS = 360_000; // 6 minutes of sampled, loaded steady state
const REQUEST_TIMEOUT_MS = 15_000;
const VIRTUAL_USERS = 6;
const THINK_TIME_MIN_MS = 250;
const THINK_TIME_MAX_MS = 750;

const WARMUP_SAMPLE_FRACTION = 0.15;
const CLIMB_THRESHOLD_PERCENT = 0.15; // 15% growth, first-quarter avg -> last-quarter avg
const CLIMB_MONOTONICITY_THRESHOLD = 0.6; // 60%+ of consecutive deltas non-decreasing

const REQUEST_PATHS = [
  { path: "/", weight: 0.25, requiresAuth: false },
  { path: "/login", weight: 0.15, requiresAuth: false },
  { path: "/pricing", weight: 0.15, requiresAuth: false },
  { path: "/how-it-works", weight: 0.1, requiresAuth: false },
  { path: "/dashboard", weight: 0.15, requiresAuth: true },
  { path: "/opportunities", weight: 0.1, requiresAuth: true },
  { path: "/settings", weight: 0.1, requiresAuth: true },
];

function fail(message) {
  console.error(`HARD FAIL: ${message}`);
  process.exit(1);
}

function nowIso() {
  return new Date().toISOString();
}

function pickWeighted(mix) {
  const r = Math.random();
  let cum = 0;
  for (const entry of mix) {
    cum += entry.weight;
    if (r < cum) return entry;
  }
  return mix[mix.length - 1];
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return { up: true, ms: Date.now() - start, status: res.status };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { up: false, ms: Date.now() - start, status: null };
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // already exited -- fine
    }
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already exited -- fine
    }
  }
}

function getRssBytes(pid) {
  if (!pid) return null;
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`,
        ],
        { encoding: "utf8", timeout: 8000 },
      );
      const val = parseInt(out.trim(), 10);
      return Number.isFinite(val) ? val : null;
    }
    const out = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8", timeout: 8000 });
    const kb = parseInt(out.trim(), 10);
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  return getRssBytes(pid) !== null;
}

function mean(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// --- Flat-vs-climbing verdict, per the method documented in the file header -
function analyzeSeries(series) {
  // series: [{ t, atIso, rssBytes }], rssBytes may be null for a dead process
  const usable = series.filter((s) => typeof s.rssBytes === "number");
  if (usable.length < 4) {
    return {
      sampleCount: series.length,
      usableSampleCount: usable.length,
      warmupSamplesExcluded: 0,
      steadyStateSampleCount: 0,
      verdict: "insufficient_data",
      note: `Only ${usable.length} usable (non-null) memory sample(s) -- need at least 4 to compute a trend.`,
    };
  }

  const warmupCount = Math.max(0, Math.floor(usable.length * WARMUP_SAMPLE_FRACTION));
  const steady = usable.slice(warmupCount);

  if (steady.length < 4) {
    return {
      sampleCount: series.length,
      usableSampleCount: usable.length,
      warmupSamplesExcluded: warmupCount,
      steadyStateSampleCount: steady.length,
      verdict: "insufficient_data",
      note: `After excluding ${warmupCount} warmup sample(s), only ${steady.length} steady-state sample(s) remain -- need at least 4.`,
    };
  }

  const quarter = Math.max(1, Math.floor(steady.length / 4));
  const firstWindow = steady.slice(0, quarter);
  const lastWindow = steady.slice(steady.length - quarter);
  const firstWindowAvg = mean(firstWindow.map((s) => s.rssBytes));
  const lastWindowAvg = mean(lastWindow.map((s) => s.rssBytes));
  const growthPercent = firstWindowAvg > 0 ? (lastWindowAvg - firstWindowAvg) / firstWindowAvg : 0;

  let nonDecreasing = 0;
  for (let i = 1; i < steady.length; i++) {
    if (steady[i].rssBytes >= steady[i - 1].rssBytes) nonDecreasing++;
  }
  const monotonicityRatio = steady.length > 1 ? nonDecreasing / (steady.length - 1) : 0;

  // Simple linear regression slope (bytes/sec) over the steady-state window,
  // reported alongside the primary growthPercent/monotonicity verdict as
  // corroborating detail, not the decision criterion itself.
  const tsSec = steady.map((s) => s.t / 1000);
  const ys = steady.map((s) => s.rssBytes);
  const n = steady.length;
  const meanT = mean(tsSec);
  const meanY = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (tsSec[i] - meanT) * (ys[i] - meanY);
    den += (tsSec[i] - meanT) ** 2;
  }
  const regressionSlopeBytesPerSec = den > 0 ? num / den : 0;

  const climbing = growthPercent > CLIMB_THRESHOLD_PERCENT && monotonicityRatio > CLIMB_MONOTONICITY_THRESHOLD;
  const verdict = climbing ? "climbing" : "flat";

  return {
    sampleCount: series.length,
    usableSampleCount: usable.length,
    warmupSamplesExcluded: warmupCount,
    steadyStateSampleCount: steady.length,
    firstBytes: usable[0].rssBytes,
    lastBytes: usable[usable.length - 1].rssBytes,
    firstWindowAvgBytes: firstWindowAvg,
    lastWindowAvgBytes: lastWindowAvg,
    growthPercent,
    monotonicityRatio,
    regressionSlopeBytesPerSec,
    thresholds: {
      climbThresholdPercent: CLIMB_THRESHOLD_PERCENT,
      climbMonotonicityThreshold: CLIMB_MONOTONICITY_THRESHOLD,
    },
    verdict,
    note:
      verdict === "climbing"
        ? `Steady-state memory grew ${(growthPercent * 100).toFixed(1)}% (first-quarter avg ${Math.round(firstWindowAvg / 1024 / 1024)}MB -> last-quarter avg ${Math.round(lastWindowAvg / 1024 / 1024)}MB) with a ${(monotonicityRatio * 100).toFixed(0)}% non-decreasing sample-to-sample ratio -- both exceed the "climbing" thresholds (>${(CLIMB_THRESHOLD_PERCENT * 100).toFixed(0)}% growth AND >${(CLIMB_MONOTONICITY_THRESHOLD * 100).toFixed(0)}% monotonicity). This is a genuine leak signal over the sampled window, not noise.`
        : `Steady-state memory changed ${(growthPercent * 100).toFixed(1)}% (first-quarter avg ${Math.round(firstWindowAvg / 1024 / 1024)}MB -> last-quarter avg ${Math.round(lastWindowAvg / 1024 / 1024)}MB), monotonicity ${(monotonicityRatio * 100).toFixed(0)}% -- below the "climbing" bar (needs >${(CLIMB_THRESHOLD_PERCENT * 100).toFixed(0)}% growth AND >${(CLIMB_MONOTONICITY_THRESHOLD * 100).toFixed(0)}% monotonicity). Classified flat.`,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = nowIso();

  // --- Resolve branch credentials from evidence, never hardcoded --------------
  if (!fs.existsSync(BRANCH_TXT)) {
    fail(`${BRANCH_TXT} does not exist -- run pt12-001-record-load-branch.mjs first.`);
  }
  const branchTxt = fs.readFileSync(BRANCH_TXT, "utf8");
  const baseUrl = branchTxt.match(/SUPABASE_URL:\s*(\S+)/)?.[1];
  const anonKey = branchTxt.match(/SUPABASE_ANON_KEY:\s*(\S+)/)?.[1];
  const serviceKey = branchTxt.match(/SUPABASE_SERVICE_ROLE_KEY:\s*(\S+)/)?.[1];
  const branchProjectRef = branchTxt.match(/branch_project_ref:\s*(\S+)/)?.[1];
  const parentProjectRef = branchTxt.match(/parent_project_ref:\s*(\S+)/)?.[1];

  if (!baseUrl || !anonKey || !serviceKey) {
    fail(`Could not parse SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY out of ${BRANCH_TXT}.`);
  }
  if (baseUrl.includes(PRODUCTION_REF) || branchProjectRef === PRODUCTION_REF) {
    fail(`Resolved branch target IS production (${PRODUCTION_REF}). Refusing to soak-test it.`);
  }
  if (parentProjectRef !== PRODUCTION_REF) {
    fail(
      `${BRANCH_TXT}'s parent_project_ref ("${parentProjectRef}") is not the production ref -- ` +
        `this does not look like a genuine branch of prod. Refusing to proceed.`,
    );
  }
  console.log(`Target (confirmed non-production branch): ${baseUrl} (ref: ${branchProjectRef})`);

  // --- Safety re-check: no 'pending' submission_queue rows on the branch ------
  // queueProcessor.dequeue() only claims status='pending' -- confirm none
  // exist right now so the worker's real automation path cannot fire during
  // this soak. This is an independent, live re-check (not trusted from any
  // prior manual finding).
  const sqRes = await fetch(`${baseUrl}/rest/v1/submission_queue?select=id,status`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!sqRes.ok) {
    fail(`Could not query submission_queue on the branch for the pre-flight safety check: HTTP ${sqRes.status}`);
  }
  const sqRows = await sqRes.json();
  const pendingRows = Array.isArray(sqRows) ? sqRows.filter((r) => r.status === "pending") : [];
  if (pendingRows.length > 0) {
    fail(
      `Safety check failed: ${pendingRows.length} submission_queue row(s) on the branch have status='pending'. ` +
        `Starting the worker would let queueProcessor claim and act on them (real browser automation against a ` +
        `real external portal). Refusing to proceed. Row ids: ${pendingRows.map((r) => r.id).join(", ")}`,
    );
  }
  console.log(
    `Safety check: PASS -- 0 of ${Array.isArray(sqRows) ? sqRows.length : 0} submission_queue row(s) on the ` +
      `branch are 'pending'; the worker's real automation path cannot fire during this soak.`,
  );

  const localEnv = dotenv.parse(fs.readFileSync(path.join(REPO_ROOT, ".env.local"), "utf8"));

  // --- Boot the real Next.js dev server, pointed at the branch ---------------
  console.log(`\nStarting Next.js server (port ${NEXT_PORT}, dist dir ${NEXT_DIST_DIR})...`);
  const nextBin = path.join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next");
  const nextChild = spawn(process.execPath, [nextBin, "dev", "-p", String(NEXT_PORT)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: baseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      PORT: String(NEXT_PORT),
      PT_AUDIT_DIST_DIR: NEXT_DIST_DIR,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let nextOutput = "";
  nextChild.stdout.on("data", (d) => (nextOutput += d.toString()));
  nextChild.stderr.on("data", (d) => (nextOutput += d.toString()));
  let nextExitInfo = null;
  nextChild.on("exit", (code, signal) => {
    nextExitInfo = { code, signal, atIso: nowIso() };
  });

  const nextReady = await waitForServer(`http://localhost:${NEXT_PORT}/login`, NEXT_READY_TIMEOUT_MS);
  if (!nextReady.up) {
    killTree(nextChild.pid);
    fail(`Next.js server did not respond within ${NEXT_READY_TIMEOUT_MS}ms. Output tail: ${nextOutput.slice(-2000)}`);
  }
  console.log(`Next.js server ready in ${nextReady.ms}ms (pid=${nextChild.pid}, status=${nextReady.status})`);

  // --- Boot the real worker, pointed at the branch ----------------------------
  console.log(`\nStarting AutoApply worker (id=${WORKER_ID}, stream port ${WORKER_STREAM_PORT})...`);
  const tsxCli = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const workerChild = spawn(process.execPath, [tsxCli, "worker/index.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...localEnv,
      SUPABASE_URL: baseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      WORKER_ID,
      PORT: String(WORKER_STREAM_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let workerOutput = "";
  workerChild.stdout.on("data", (d) => (workerOutput += d.toString()));
  workerChild.stderr.on("data", (d) => (workerOutput += d.toString()));
  let workerExitInfo = null;
  workerChild.on("exit", (code, signal) => {
    workerExitInfo = { code, signal, atIso: nowIso() };
  });

  await new Promise((r) => setTimeout(r, WORKER_SETTLE_MS));
  if (!isPidAlive(workerChild.pid)) {
    killTree(nextChild.pid);
    fail(`Worker process exited during startup settle window. Output tail: ${workerOutput.slice(-2000)}`);
  }
  console.log(`Worker settled after ${WORKER_SETTLE_MS}ms, still running (pid=${workerChild.pid}).`);
  console.log(`Worker boot output so far:\n${workerOutput.slice(-1500)}`);

  const bothProcessesUpAt = nowIso();

  // --- Unsampled warmup: prime each unique route's first (slow) compile ------
  console.log(`\nWarming up ${REQUEST_PATHS.length} route(s) (absorbs first-compile cost, not sampled)...`);
  let totalWarmupRequests = 0;
  for (const entry of REQUEST_PATHS) {
    const url = `http://localhost:${NEXT_PORT}${entry.path}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), WARMUP_REQUEST_TIMEOUT_MS);
    try {
      const t0 = Date.now();
      const res = await fetch(url, { redirect: "manual", signal: ac.signal });
      await res.text();
      console.log(`  warmup ${entry.path} -> ${res.status} in ${Date.now() - t0}ms`);
      totalWarmupRequests++;
    } catch (err) {
      console.log(`  warmup ${entry.path} -> error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Load generator: fixed virtual users, weighted mix, steady state -------
  const requestStats = { total: 0, errors: 0 };
  let loadStop = false;

  async function requestOnce() {
    const entry = pickWeighted(REQUEST_PATHS);
    const url = `http://localhost:${NEXT_PORT}${entry.path}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { redirect: "manual", signal: ac.signal });
      await res.text();
      clearTimeout(timer);
      requestStats.total++;
      // A protected route returning a 200 (not a redirect) with no session
      // would be a real bug worth flagging, but is not this script's concern
      // -- only genuine transport/timeout failures count as load-generator
      // errors here.
      if (res.status >= 500) requestStats.errors++;
    } catch {
      clearTimeout(timer);
      requestStats.total++;
      requestStats.errors++;
    }
  }

  async function virtualUser() {
    while (!loadStop) {
      await requestOnce();
      const think = THINK_TIME_MIN_MS + Math.random() * (THINK_TIME_MAX_MS - THINK_TIME_MIN_MS);
      await new Promise((r) => setTimeout(r, think));
    }
  }

  console.log(
    `\nStarting sustained soak: ${VIRTUAL_USERS} virtual users, ${SOAK_DURATION_MS / 1000}s, ` +
      `sampling memory every ${SAMPLE_INTERVAL_MS / 1000}s...\n`,
  );
  const soakStartedAt = nowIso();
  const soakStartT = Date.now();

  const memorySeries = { next: [], worker: [] };
  let nextDiedDuringSoak = false;
  let workerDiedDuringSoak = false;

  const loadPromise = Promise.all(Array.from({ length: VIRTUAL_USERS }, () => virtualUser()));

  const totalSamples = Math.floor(SOAK_DURATION_MS / SAMPLE_INTERVAL_MS);
  for (let i = 0; i <= totalSamples; i++) {
    const t = Date.now() - soakStartT;
    const atIso = nowIso();
    const nextRss = isPidAlive(nextChild.pid) ? getRssBytes(nextChild.pid) : null;
    const workerRss = isPidAlive(workerChild.pid) ? getRssBytes(workerChild.pid) : null;
    if (nextRss === null && !nextDiedDuringSoak) nextDiedDuringSoak = true;
    if (workerRss === null && !workerDiedDuringSoak) workerDiedDuringSoak = true;
    memorySeries.next.push({ t, atIso, rssBytes: nextRss });
    memorySeries.worker.push({ t, atIso, rssBytes: workerRss });
    console.log(
      `  [t=${(t / 1000).toFixed(0)}s] next=${nextRss !== null ? Math.round(nextRss / 1024 / 1024) + "MB" : "DEAD"} ` +
        `worker=${workerRss !== null ? Math.round(workerRss / 1024 / 1024) + "MB" : "DEAD"} ` +
        `requests=${requestStats.total} errors=${requestStats.errors}`,
    );
    if (i < totalSamples) {
      await new Promise((r) => setTimeout(r, SAMPLE_INTERVAL_MS));
    }
  }

  loadStop = true;
  await Promise.race([loadPromise, new Promise((r) => setTimeout(r, REQUEST_TIMEOUT_MS + 2000))]);

  const soakEndedAt = nowIso();
  const soakDurationMsActual = Date.now() - soakStartT;

  // --- Shutdown both processes -------------------------------------------------
  console.log(`\nShutting down Next.js server (pid=${nextChild.pid}) and worker (pid=${workerChild.pid})...`);
  killTree(nextChild.pid);
  killTree(workerChild.pid);
  await new Promise((r) => setTimeout(r, 1000));

  // --- Analyze both series ------------------------------------------------------
  const nextAnalysis = analyzeSeries(memorySeries.next);
  const workerAnalysis = analyzeSeries(memorySeries.worker);

  const anyClimbing = nextAnalysis.verdict === "climbing" || workerAnalysis.verdict === "climbing";
  const overallVerdict = anyClimbing ? "LEAK_FOUND" : "PASS_NO_LEAK";

  const findingsNote = anyClimbing
    ? `LEAK FOUND (P1): ` +
      [
        nextAnalysis.verdict === "climbing" ? `Next.js server memory is climbing -- ${nextAnalysis.note}` : null,
        workerAnalysis.verdict === "climbing" ? `Worker process memory is climbing -- ${workerAnalysis.note}` : null,
      ]
        .filter(Boolean)
        .join(" ") +
      ` This takes production down over time under sustained load and must be root-caused before ship.`
    : `No memory leak detected in either process over the ${(soakDurationMsActual / 1000).toFixed(0)}s sampled, ` +
      `loaded soak window. Next.js: ${nextAnalysis.note} Worker: ${workerAnalysis.note}`;

  console.log(`\n${findingsNote}`);
  if (nextDiedDuringSoak) console.log(`NOTE: the Next.js server process died at some point during the soak.`);
  if (workerDiedDuringSoak) console.log(`NOTE: the worker process died at some point during the soak.`);

  // --- Write machine-readable evidence -----------------------------------------
  const evidence = {
    recordedAt: nowIso(),
    startedAt,
    target: {
      supabaseUrl: baseUrl,
      branchProjectRef,
      parentProjectRef,
      productionRef: PRODUCTION_REF,
      isProductionTarget: false,
    },
    safetyCheck: {
      submissionQueueRowsChecked: Array.isArray(sqRows) ? sqRows.length : 0,
      pendingRowsFound: pendingRows.length,
      passed: pendingRows.length === 0,
    },
    processes: {
      next: {
        role: "next-server",
        pid: nextChild.pid,
        port: NEXT_PORT,
        distDir: NEXT_DIST_DIR,
        readyAfterMs: nextReady.ms,
        bothProcessesUpAt,
        exitedDuringSoak: nextDiedDuringSoak,
        exitInfo: nextExitInfo,
      },
      worker: {
        role: "autoapply-worker",
        pid: workerChild.pid,
        workerId: WORKER_ID,
        streamPort: WORKER_STREAM_PORT,
        settleMs: WORKER_SETTLE_MS,
        bothProcessesUpAt,
        exitedDuringSoak: workerDiedDuringSoak,
        exitInfo: workerExitInfo,
        bootOutputTail: workerOutput.slice(-2000),
      },
    },
    soak: {
      warmupRequestsSent: totalWarmupRequests,
      startedAt: soakStartedAt,
      endedAt: soakEndedAt,
      sampledDurationMsTarget: SOAK_DURATION_MS,
      sampledDurationMsActual: soakDurationMsActual,
      sampleIntervalMsTarget: SAMPLE_INTERVAL_MS,
      virtualUsers: VIRTUAL_USERS,
      requestPaths: REQUEST_PATHS,
      totalRequestsSent: requestStats.total,
      totalRequestErrors: requestStats.errors,
      requestErrorRate: requestStats.total > 0 ? requestStats.errors / requestStats.total : null,
    },
    memorySeries,
    analysis: {
      next: nextAnalysis,
      worker: workerAnalysis,
    },
    findings: {
      next: nextAnalysis.verdict,
      worker: workerAnalysis.verdict,
      overallVerdict,
      note: findingsNote,
    },
  };

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(evidence, null, 2), "utf8");

  const lines = [
    `PT-12-003 — Sustained Soak + Memory-Growth Tracking — ${evidence.recordedAt}`,
    ``,
    `=== TARGET (confirmed non-production) ===`,
    `SUPABASE_URL:        ${baseUrl}`,
    `branch_project_ref:  ${branchProjectRef}`,
    `parent_project_ref:  ${parentProjectRef}`,
    `production_ref:      ${PRODUCTION_REF}`,
    `isProductionTarget:  false`,
    ``,
    `=== SAFETY CHECK ===`,
    `submission_queue rows checked: ${evidence.safetyCheck.submissionQueueRowsChecked}`,
    `'pending' rows found:          ${evidence.safetyCheck.pendingRowsFound}`,
    `worker automation path armed:  ${evidence.safetyCheck.passed ? "NO (safe)" : "YES -- would have aborted"}`,
    ``,
    `=== PROCESSES ===`,
    `next server: pid=${nextChild.pid} port=${NEXT_PORT} distDir=${NEXT_DIST_DIR} readyAfterMs=${nextReady.ms} exitedDuringSoak=${nextDiedDuringSoak}`,
    `worker:      pid=${workerChild.pid} id=${WORKER_ID} streamPort=${WORKER_STREAM_PORT} exitedDuringSoak=${workerDiedDuringSoak}`,
    ``,
    `=== SOAK ===`,
    `warmup requests: ${totalWarmupRequests}`,
    `sampled duration: target=${SOAK_DURATION_MS / 1000}s actual=${(soakDurationMsActual / 1000).toFixed(1)}s`,
    `sample interval: ${SAMPLE_INTERVAL_MS / 1000}s`,
    `virtual users: ${VIRTUAL_USERS}`,
    `total requests sent: ${requestStats.total}`,
    `total request errors: ${requestStats.errors} (rate: ${((evidence.soak.requestErrorRate ?? 0) * 100).toFixed(2)}%)`,
    ``,
    `=== MEMORY SERIES (next) ===`,
    ...memorySeries.next.map(
      (s) => `  t=${(s.t / 1000).toFixed(0)}s  ${s.rssBytes !== null ? Math.round(s.rssBytes / 1024 / 1024) + "MB" : "DEAD"}`,
    ),
    ``,
    `=== MEMORY SERIES (worker) ===`,
    ...memorySeries.worker.map(
      (s) => `  t=${(s.t / 1000).toFixed(0)}s  ${s.rssBytes !== null ? Math.round(s.rssBytes / 1024 / 1024) + "MB" : "DEAD"}`,
    ),
    ``,
    `=== ANALYSIS: next ===`,
    JSON.stringify(nextAnalysis, null, 2),
    ``,
    `=== ANALYSIS: worker ===`,
    JSON.stringify(workerAnalysis, null, 2),
    ``,
    `=== FINDINGS ===`,
    `next verdict:    ${nextAnalysis.verdict}`,
    `worker verdict:  ${workerAnalysis.verdict}`,
    `overallVerdict:  ${overallVerdict}`,
    ``,
    findingsNote,
    ``,
    `RESULT: ${overallVerdict === "LEAK_FOUND" ? "FINDING RECORDED (memory leak detected -- see above)" : "PASS (no leak detected, evidence recorded)"}`,
  ];
  fs.writeFileSync(RESULTS_TXT, lines.join("\n") + "\n", "utf8");

  console.log(`\nWrote ${RESULTS_JSON}`);
  console.log(`Wrote ${RESULTS_TXT}`);

  // This script's own exit code reflects whether it successfully RAN the soak
  // and recorded evidence, not whether a leak was found -- a "climbing"
  // verdict is a valid, successfully-recorded finding (see verify-pt12-003.mjs
  // for the structural checks), not a script failure. Exit 0 either way.
  process.exit(0);
}

main().catch((err) => {
  console.error(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
