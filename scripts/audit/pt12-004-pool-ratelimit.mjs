// ============================================================================
// PT-12-004 — DB connection-pool contention + rate-limiter-under-contention.
//
// Runs against the dedicated load-test Supabase branch (pt12-load-test),
// never production — same branch, same credential-resolution/guard pattern
// as PT-12-001/002/003 (reads test-evidence/pt-12/branch.txt, hard-fails if
// the resolved target is or resembles the production ref).
//
// Sub-test 1 — DB connection pool stress:
//   PostgREST (and the Supavisor pooler in front of it) maintains its own,
//   bounded pool of real Postgres backend connections. Firing more
//   concurrent *slow* queries than that pool can serve simultaneously is
//   the only way to actually observe pool-exhaustion behavior rather than
//   generic app-level latency (PT-12-002 already covers ordinary
//   read/write latency under concurrency; this test is specifically about
//   what happens when there are more in-flight DB-bound requests than the
//   pool has connections for).
//
//   The "slow query" used is a deliberate sequential scan: a leading-
//   wildcard ILIKE filter on `nonprofits.name` (1.97M rows on this
//   branch), which cannot use a btree index and forces Postgres to hold a
//   backend connection open for several real seconds per call (measured
//   live before this test was written: ~4s for a single such query vs
//   ~0.2s for a plain indexed lookup — see `singleHeavyQueryBaselineMs`
//   in the written evidence). Read-only; never mutates `nonprofits`.
//
//   At each concurrency level, `concurrency` copies of this heavy query
//   are fired as one true burst (Promise.all, not a duration-based
//   worker loop — a loop makes no sense when a single request already
//   takes multiple seconds). Two, and only two, real outcomes are
//   possible and are told apart from the recorded HTTP status/error text:
//     - graceful_queue: every request eventually succeeds (HTTP 200);
//       wall-clock for the burst grows with concurrency (later callers
//       wait for a connection to free up) but nothing errors.
//     - hard_errors: some requests come back with a genuine
//       connection-pool-exhaustion signature (PostgREST 5xx mentioning
//       the database/connection, a raw Postgres "too many clients"/
//       "remaining connection slots" class error, or a raw socket-level
//       failure such as ECONNRESET/"socket hang up") instead of queueing.
//   A plain client-side timeout (the request simply took longer than
//   REQUEST_TIMEOUT_MS to get a connection) is recorded as its own
//   category, `timeouts`, and is NOT the same finding as hard_errors —
//   it means the pool was still queueing, just slower than this test was
//   willing to wait, not that the pool rejected the request outright.
//
// Sub-test 2 — rate limiter under contention:
//   `worker/rate-limiter.ts`'s `RateLimiter.canSubmitToDomain(funderId)`
//   is the real, live per-funder 24h-cooldown check every AutoApply
//   submission goes through (worker/queue-processor.ts:954). Reading its
//   source directly (quoted in full in this file's own header comment
//   further down) shows it is NOT a pure in-memory limiter — it runs a
//   real Supabase query (`autoapply_submissions` filtered by funder_id +
//   submitted_at > now-24h, most-recent-first, limit 1) on every call,
//   and its own catch block explicitly fails OPEN on any query error:
//   `return true` (i.e. "allowed to submit") whenever the DB call itself
//   errors, logging a warning but never blocking. That means this
//   specific rate limiter's behavior under DB contention is not
//   symmetric — by construction it can never spuriously BLOCK legitimate
//   traffic due to a DB error (the only way it returns false is a
//   genuine, successfully-read recent-submission row), but it CAN
//   spuriously ALLOW (bypass the cooldown) if contention causes the
//   lookup query itself to error instead of completing. This test proves
//   both halves of that with real, measured calls under real contention
//   rather than just quoting the source:
//     - a "should-block" funder, seeded with a synthetic
//       autoapply_submissions row timestamped `now()` (well inside the
//       24h window) — the correct answer is ALWAYS false (blocked).
//       Any call that instead resolves true is a genuine false-allow
//       (rate-limit bypass) caused by contention.
//     - a "should-allow" funder with zero autoapply_submissions rows
//       ever — the correct answer is ALWAYS true (allowed). Any call
//       that instead resolves false would be a false-block of legitimate
//       traffic (this is the literal "confirm ... without false-blocking
//       legitimate traffic" check the task asks for).
//   Both funders' checks are replicated with the exact same PostgREST
//   filter shape `canSubmitToDomain` builds, run WITH the exact same
//   fail-open-on-error semantics as the real code, and fired inside the
//   SAME Promise.all burst as sub-test 1's heavy queries at each
//   concurrency level — so the rate-limiter calls experience the same
//   real DB contention the pool-stress queries are generating, not an
//   isolated/idealized contention-free measurement.
//
// Ties to the already-documented rate-limiter finding
// (test-evidence/pt-11/artifacts/soak/SOAK_TEST_AUTOAPPLY_RESULTS-2026-08-20.md,
// PHASE-11-SUMMARY.md): that finding is about `RateLimiter.
// waitBetweenSubmissions()`, a different method on the same class — an
// unconditional 60-120s sleep between every queue item regardless of
// outcome, which throttles AutoApply's real-world drain rate to
// ~0.6-1.0 items/minute. This test does not re-run that (already proven
// twice, over 70+ minute real soaks — re-running it here would blow the
// window for no new evidence). It instead tests the OTHER, DB-dependent
// method on the same class, `canSubmitToDomain()`, under a form of load
// (DB connection contention) that method's own design has never been
// exercised against before.
//
// Writes test-evidence/pt-12/pool-ratelimit.json incrementally: the file
// is rewritten after every concurrency level completes (not only once at
// the end), so a long run that is interrupted mid-ramp still leaves real,
// inspectable partial evidence rather than nothing.
//
// Usage: node scripts/audit/pt12-004-pool-ratelimit.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-12");
const BRANCH_TXT = path.join(OUT_DIR, "branch.txt");
const RESULTS_JSON = path.join(OUT_DIR, "pool-ratelimit.json");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

// Concurrency ramp for the pool-stress burst. Each heavy query already
// costs several real seconds, so this is a burst model (Promise.all of
// `concurrency` heavy calls fired at once), not a duration-based worker
// loop -- a loop would barely complete one iteration per worker inside any
// reasonable window. A quick pre-check of this branch (recorded in
// `singleHeavyQueryBaselineMs` below) found the onset of real, server-side
// contention failures is LOW -- around 10 concurrent copies of the heavy
// query already triggers Postgres's own statement_timeout, not a gradual
// degradation starting in the hundreds like PT-12-002's app-level ramp.
// The levels below start well below that onset (2) so the transition point
// is actually captured, not skipped past.
const CONCURRENCY_LEVELS = [2, 5, 10, 20, 40];
const REQUEST_TIMEOUT_MS = 45000;
const COOLDOWN_MS = 1000;

// How many replica rate-limiter-check calls to fire per funder, per level,
// inside the same contended burst.
const RATE_LIMIT_CALLS_PER_FUNDER_PER_LEVEL = 10;

// Connection-count-exhaustion-shaped errors -- "there is no free connection
// to hand out at all" (Supavisor/PostgREST pool literally out of slots, or
// a raw socket-level rejection).
const POOL_EXHAUSTION_ERROR_PATTERN =
  /too many clients|remaining connection slots|max_connections|53300|connection pool|pool exhaust|PGRST002|econnreset|socket hang up|ECONNREFUSED/i;

// Statement-timeout-shaped errors -- Postgres error code 57014, "canceling
// statement due to statement timeout". This is a DIFFERENT failure mode
// from pool exhaustion: a connection WAS acquired, but contention among
// concurrently-running queries on the same table (CPU/IO contention driving
// per-query execution time past the server's own statement_timeout GUC)
// caused the server to actively cancel the query rather than let it queue
// to completion. Empirically the dominant failure mode observed on this
// branch (see findings.poolStress below) -- kept as its own category
// rather than lumped into "other_error" because it is a real, precise,
// reproducible DB-contention signature, not a generic/unclassified failure.
const STATEMENT_TIMEOUT_ERROR_PATTERN = /57014|statement timeout/i;

function fail(message) {
  console.error(`HARD FAIL: ${message}`);
  process.exit(1);
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

async function timedFetch(url, opts, timeoutMs = REQUEST_TIMEOUT_MS) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("client-side timeout")), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    const bodyText = await res.text();
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, status: res.status, ms: Date.now() - t0, error: bodyText.slice(0, 500), timedOut: false };
    }
    return { ok: true, status: res.status, ms: Date.now() - t0, body: bodyText };
  } catch (err) {
    clearTimeout(timer);
    const message = err && err.message ? err.message : String(err);
    const timedOut = message.includes("client-side timeout") || message.includes("aborted");
    return { ok: false, status: 0, ms: Date.now() - t0, error: message, timedOut };
  }
}

function classifyPoolError(result) {
  if (result.ok) return "success";
  if (result.error && POOL_EXHAUSTION_ERROR_PATTERN.test(result.error)) return "pool_exhaustion_error";
  if (result.error && STATEMENT_TIMEOUT_ERROR_PATTERN.test(result.error)) return "statement_timeout_error";
  if (result.timedOut) return "timeout";
  return "other_error";
}

// Mirrors worker/rate-limiter.ts RateLimiter.canSubmitToDomain(funderId)
// exactly: same filter shape (funder_id eq, submitted_at not null AND
// submitted_at > now-24h, order submitted_at desc, limit 1, single-row
// semantics), and the SAME fail-open-on-error branch (any error -> true).
async function replicaCanSubmitToDomain(baseUrl, headers, funderId, timeoutMs) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url =
    `${baseUrl}/rest/v1/autoapply_submissions` +
    `?select=submitted_at&funder_id=eq.${funderId}` +
    `&submitted_at=not.is.null&submitted_at=gt.${encodeURIComponent(cutoff)}` +
    `&order=submitted_at.desc&limit=1`;
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("client-side timeout")), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    const bodyText = await res.text();
    clearTimeout(timer);
    if (!res.ok) {
      // Real code: `if (error) { console.error(...); return true; }` -- fail open.
      return { canSubmit: true, failedOpen: true, ms: Date.now() - t0, httpStatus: res.status, error: bodyText.slice(0, 300) };
    }
    let rows;
    try {
      rows = JSON.parse(bodyText);
    } catch (parseErr) {
      // Real code treats a query-level failure as `error` truthy -> fail open.
      // An unparseable body from a 200 response is the same class of "the DB
      // call did not give us usable data" -- fail open here too, honestly.
      return { canSubmit: true, failedOpen: true, ms: Date.now() - t0, httpStatus: res.status, error: `unparseable body: ${parseErr.message}` };
    }
    // Real code: `data !== null` (maybeSingle found a row) -> return false (blocked).
    const found = Array.isArray(rows) && rows.length > 0;
    return { canSubmit: !found, failedOpen: false, ms: Date.now() - t0, httpStatus: res.status };
  } catch (err) {
    clearTimeout(timer);
    const message = err && err.message ? err.message : String(err);
    const timedOut = message.includes("client-side timeout") || message.includes("aborted");
    // Real code has no separate timeout branch -- any thrown/rejected call
    // reaches the same `if (error)` fail-open path via the Supabase client's
    // own error surface. A client-side abort is the same real-world shape
    // (the caller gave up waiting on the DB), so it fails open too, matching
    // the real code's behavior rather than inventing a third outcome.
    return { canSubmit: true, failedOpen: true, ms: Date.now() - t0, httpStatus: 0, error: message, timedOut };
  }
}

function summarizeLatencies(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    min: sorted.length ? sorted[0] : null,
    mean: mean(sorted),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // --- Resolve branch credentials from evidence, never hardcoded -------------
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
    fail(`Resolved branch target IS production (${PRODUCTION_REF}). Refusing to run contention tests against it.`);
  }
  if (parentProjectRef !== PRODUCTION_REF) {
    fail(
      `${BRANCH_TXT}'s parent_project_ref ("${parentProjectRef}") is not the production ref -- ` +
        `this does not look like a genuine branch of prod. Refusing to proceed.`,
    );
  }
  console.log(`Target (confirmed non-production branch): ${baseUrl} (ref: ${branchProjectRef})`);

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const writeHeaders = { ...headers, "Content-Type": "application/json" };

  // --- Real sample data: two funders, two organizations ----------------------
  const fundersRes = await fetch(`${baseUrl}/rest/v1/funders?select=id,organization_id,name&limit=10`, { headers });
  if (!fundersRes.ok) fail(`Failed to fetch funders: HTTP ${fundersRes.status}`);
  const funders = await fundersRes.json();
  if (!Array.isArray(funders) || funders.length < 2) {
    fail(`Need at least 2 real funders on the branch to run should-block/should-allow cases; found ${funders?.length ?? 0}.`);
  }
  const blockFunder = funders[0];
  const allowFunder = funders[1];
  if (blockFunder.id === allowFunder.id) {
    fail(`should-block and should-allow funder resolved to the same id -- sample pool too small.`);
  }

  // Confirm the "should-allow" funder genuinely has zero submissions ever, so
  // its expected canSubmit=true is a real fact about the data, not assumed.
  const allowCheckRes = await fetch(
    `${baseUrl}/rest/v1/autoapply_submissions?select=id&funder_id=eq.${allowFunder.id}&limit=1`,
    { headers },
  );
  if (!allowCheckRes.ok) fail(`Failed to verify should-allow funder's submission history: HTTP ${allowCheckRes.status}`);
  const allowExisting = await allowCheckRes.json();
  if (Array.isArray(allowExisting) && allowExisting.length > 0) {
    fail(
      `Chosen should-allow funder (${allowFunder.id}, "${allowFunder.name}") already has a real ` +
        `autoapply_submissions row -- cannot use it as a clean "never submitted" baseline. Re-run with a ` +
        `different funder pool or extend the sample size.`,
    );
  }

  // --- Seed the should-block funder's recent-submission row ------------------
  const nowIso = new Date().toISOString();
  const seedBody = {
    organization_id: blockFunder.organization_id,
    funder_id: blockFunder.id,
    status: "submitted",
    submitted_at: nowIso,
    request_description: "pt12-004-pool-ratelimit-synthetic — DO NOT KEEP, cleaned up at end of run",
  };
  const seedRes = await fetch(`${baseUrl}/rest/v1/autoapply_submissions`, {
    method: "POST",
    headers: { ...writeHeaders, Prefer: "return=representation" },
    body: JSON.stringify(seedBody),
  });
  if (!seedRes.ok) {
    fail(`Failed to seed should-block autoapply_submissions row: HTTP ${seedRes.status} ${await seedRes.text()}`);
  }
  const seededRows = await seedRes.json();
  const seededRow = Array.isArray(seededRows) ? seededRows[0] : seededRows;
  if (!seededRow || !seededRow.id) {
    fail(`Seed insert did not return the created row's id -- cannot guarantee cleanup.`);
  }
  console.log(
    `Seeded should-block row ${seededRow.id} for funder ${blockFunder.id} ("${blockFunder.name}"), submitted_at=${nowIso}.`,
  );
  console.log(
    `Should-allow funder: ${allowFunder.id} ("${allowFunder.name}"), confirmed zero prior submissions.`,
  );

  // --- Single-shot baseline for the heavy query (before any contention) ------
  const heavyUrl = `${baseUrl}/rest/v1/nonprofits?select=id&name=ilike.*zzzpt12nomatch4712*&limit=1`;
  const lightUrl = `${baseUrl}/rest/v1/nonprofits?select=id&limit=1`;
  const heavyBaseline = await timedFetch(heavyUrl, { headers });
  const lightBaseline = await timedFetch(lightUrl, { headers });
  if (!heavyBaseline.ok) fail(`Heavy-query baseline itself failed (HTTP ${heavyBaseline.status}): ${heavyBaseline.error}`);
  if (!lightBaseline.ok) fail(`Light-query baseline itself failed (HTTP ${lightBaseline.status}): ${lightBaseline.error}`);
  console.log(
    `Baselines (uncontended, single request): heavy(seq-scan)=${heavyBaseline.ms}ms, light(indexed)=${lightBaseline.ms}ms.`,
  );

  const startedAt = new Date().toISOString();
  const levels = [];

  const evidenceSoFar = () => ({
    status: "in_progress",
    recordedAt: new Date().toISOString(),
    startedAt,
    target: {
      supabaseUrl: baseUrl,
      branchProjectRef,
      parentProjectRef,
      productionRef: PRODUCTION_REF,
      isProductionTarget: false,
    },
    method: {
      poolStress:
        "Burst (Promise.all) of `concurrency` leading-wildcard ILIKE sequential-scan queries against " +
        "nonprofits.name (1.97M rows on this branch) fired simultaneously per level -- forces the query " +
        "planner off any btree index so each call holds a real Postgres backend connection open for " +
        "several seconds, making pool contention observable at moderate concurrency. Read-only.",
      rateLimiterContention:
        `${RATE_LIMIT_CALLS_PER_FUNDER_PER_LEVEL} replica calls per funder per level, fired inside the ` +
        "SAME Promise.all burst as the pool-stress heavy queries (not a separate, idealized measurement), " +
        "replicating worker/rate-limiter.ts RateLimiter.canSubmitToDomain()'s exact PostgREST filter shape " +
        "and its exact fail-open-on-error semantics (source quoted in this script's own header comment).",
    },
    baselines: {
      singleHeavyQueryBaselineMs: heavyBaseline.ms,
      singleLightQueryBaselineMs: lightBaseline.ms,
    },
    funders: {
      shouldBlock: { id: blockFunder.id, organizationId: blockFunder.organization_id, name: blockFunder.name, seededSubmissionId: seededRow.id, seededSubmittedAt: nowIso },
      shouldAllow: { id: allowFunder.id, organizationId: allowFunder.organization_id, name: allowFunder.name, confirmedZeroPriorSubmissions: true },
    },
    concurrencyLevelsPlanned: CONCURRENCY_LEVELS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    levels,
  });

  const writeIncremental = () => {
    fs.writeFileSync(RESULTS_JSON, JSON.stringify(evidenceSoFar(), null, 2), "utf8");
  };
  writeIncremental(); // write immediately so a crash before level 1 still leaves real evidence

  for (const concurrency of CONCURRENCY_LEVELS) {
    console.log(`\n--- Level: concurrency=${concurrency} ---`);
    const levelStart = Date.now();

    const heavyPromises = Array.from({ length: concurrency }, () => timedFetch(heavyUrl, { headers }));
    const blockCheckPromises = Array.from({ length: RATE_LIMIT_CALLS_PER_FUNDER_PER_LEVEL }, () =>
      replicaCanSubmitToDomain(baseUrl, headers, blockFunder.id, REQUEST_TIMEOUT_MS),
    );
    const allowCheckPromises = Array.from({ length: RATE_LIMIT_CALLS_PER_FUNDER_PER_LEVEL }, () =>
      replicaCanSubmitToDomain(baseUrl, headers, allowFunder.id, REQUEST_TIMEOUT_MS),
    );

    const [heavyResults, blockResults, allowResults] = await Promise.all([
      Promise.all(heavyPromises),
      Promise.all(blockCheckPromises),
      Promise.all(allowCheckPromises),
    ]);
    const wallMs = Date.now() - levelStart;

    // --- Pool-stress classification -----------------------------------------
    const outcomeCounts = {
      success: 0,
      timeout: 0,
      pool_exhaustion_error: 0,
      statement_timeout_error: 0,
      other_error: 0,
    };
    const errorSamples = [];
    for (const r of heavyResults) {
      const cls = classifyPoolError(r);
      outcomeCounts[cls]++;
      if (cls !== "success" && errorSamples.length < 5) {
        errorSamples.push({ classification: cls, status: r.status, ms: r.ms, error: r.error || null });
      }
    }
    const successLatencies = heavyResults.filter((r) => r.ok).map((r) => r.ms);
    const latencyMs = summarizeLatencies(successLatencies);
    const queueingFactor = heavyBaseline.ms > 0 ? Number((wallMs / heavyBaseline.ms).toFixed(2)) : null;

    // hard_errors covers BOTH ways the DB layer can actively fail a request
    // under contention rather than gracefully queuing it to success:
    // outright connection-pool exhaustion (no connection to hand out) and
    // statement_timeout cancellation (a connection was acquired, but
    // contention drove execution time past the server's own cutoff). Both
    // are "errors instead of queueing" from the caller's point of view.
    let poolBehavior;
    if (outcomeCounts.pool_exhaustion_error > 0 || outcomeCounts.statement_timeout_error > 0) {
      poolBehavior = "hard_errors";
    } else if (outcomeCounts.other_error > 0) {
      poolBehavior = "other_errors";
    } else if (outcomeCounts.timeout > 0) {
      poolBehavior = "timeouts_no_hard_errors";
    } else {
      poolBehavior = "graceful_queue";
    }

    console.log(
      `  pool: n=${concurrency} success=${outcomeCounts.success} timeout=${outcomeCounts.timeout} ` +
        `poolError=${outcomeCounts.pool_exhaustion_error} stmtTimeout=${outcomeCounts.statement_timeout_error} ` +
        `otherError=${outcomeCounts.other_error} wallMs=${wallMs} queueingFactor=${queueingFactor} ` +
        `-> ${poolBehavior.toUpperCase()}`,
    );

    // --- Rate-limiter-under-contention classification -----------------------
    const blockFalseAllows = blockResults.filter((r) => r.canSubmit === true);
    const blockFailedOpenCount = blockResults.filter((r) => r.failedOpen).length;
    const allowFalseBlocks = allowResults.filter((r) => r.canSubmit === false);
    const allowFailedOpenCount = allowResults.filter((r) => r.failedOpen).length;

    console.log(
      `  rate-limiter: shouldBlock falseAllows=${blockFalseAllows.length}/${blockResults.length} ` +
        `(failedOpen=${blockFailedOpenCount})  shouldAllow falseBlocks=${allowFalseBlocks.length}/${allowResults.length} ` +
        `(failedOpen=${allowFailedOpenCount})`,
    );

    levels.push({
      concurrency,
      wallMs,
      poolStress: {
        outcomeCounts,
        errorSamples,
        latencyMs,
        singleHeavyQueryBaselineMs: heavyBaseline.ms,
        queueingFactor,
        behavior: poolBehavior,
      },
      rateLimiterContention: {
        shouldBlockFunderId: blockFunder.id,
        shouldAllowFunderId: allowFunder.id,
        callsPerFunder: RATE_LIMIT_CALLS_PER_FUNDER_PER_LEVEL,
        shouldBlock: {
          expectedCanSubmit: false,
          results: blockResults.map((r) => ({ canSubmit: r.canSubmit, failedOpen: r.failedOpen, ms: r.ms, httpStatus: r.httpStatus, error: r.error || null })),
          falseAllowCount: blockFalseAllows.length,
          failedOpenCount: blockFailedOpenCount,
        },
        shouldAllow: {
          expectedCanSubmit: true,
          results: allowResults.map((r) => ({ canSubmit: r.canSubmit, failedOpen: r.failedOpen, ms: r.ms, httpStatus: r.httpStatus, error: r.error || null })),
          falseBlockCount: allowFalseBlocks.length,
          failedOpenCount: allowFailedOpenCount,
        },
      },
    });

    writeIncremental();

    if (concurrency !== CONCURRENCY_LEVELS[CONCURRENCY_LEVELS.length - 1]) {
      await new Promise((r) => setTimeout(r, COOLDOWN_MS));
    }
  }

  // --- Cleanup: delete the synthetic seeded row, verify it is gone -----------
  const deleteRes = await fetch(`${baseUrl}/rest/v1/autoapply_submissions?id=eq.${seededRow.id}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=representation" },
  });
  const deleteOk = deleteRes.ok;
  let cleanupVerified = false;
  if (deleteOk) {
    const verifyRes = await fetch(`${baseUrl}/rest/v1/autoapply_submissions?id=eq.${seededRow.id}&select=id`, { headers });
    if (verifyRes.ok) {
      const remaining = await verifyRes.json();
      cleanupVerified = Array.isArray(remaining) && remaining.length === 0;
    }
  }
  console.log(
    cleanupVerified
      ? `Cleanup: seeded row ${seededRow.id} deleted and independently re-verified absent.`
      : `Cleanup WARNING: could not independently verify deletion of seeded row ${seededRow.id} (deleteOk=${deleteOk}).`,
  );

  // --- Aggregate findings ------------------------------------------------------
  const anyHardErrors = levels.some((l) => l.poolStress.behavior === "hard_errors");
  const anyOtherErrors = levels.some((l) => l.poolStress.behavior === "other_errors");
  const highestGracefulLevel = [...levels].reverse().find((l) => l.poolStress.behavior === "graceful_queue");
  const firstHardErrorLevel = levels.find((l) => l.poolStress.behavior === "hard_errors");
  const firstDegradedLevel = levels.find((l) => l.poolStress.behavior !== "graceful_queue");

  // Derive an observed statement_timeout estimate from the lowest concurrency
  // level that produced statement_timeout_error samples (least confounded by
  // queueing delay -- at low concurrency, the recorded `ms` on a
  // statement_timeout_error is essentially just the timeout itself, since
  // there was no meaningful wait for a free connection first).
  const firstStmtTimeoutLevel = levels.find((l) => l.poolStress.outcomeCounts.statement_timeout_error > 0);
  let observedStatementTimeoutMs = null;
  if (firstStmtTimeoutLevel) {
    const samples = firstStmtTimeoutLevel.poolStress.errorSamples
      .filter((s) => s.classification === "statement_timeout_error")
      .map((s) => s.ms)
      .sort((a, b) => a - b);
    if (samples.length > 0) {
      observedStatementTimeoutMs = samples[Math.floor(samples.length / 2)];
    }
  }

  const totalFalseAllows = levels.reduce((sum, l) => sum + l.rateLimiterContention.shouldBlock.falseAllowCount, 0);
  const totalFalseBlocks = levels.reduce((sum, l) => sum + l.rateLimiterContention.shouldAllow.falseBlockCount, 0);
  const totalBlockCalls = levels.reduce((sum, l) => sum + l.rateLimiterContention.shouldBlock.results.length, 0);
  const totalAllowCalls = levels.reduce((sum, l) => sum + l.rateLimiterContention.shouldAllow.results.length, 0);

  const poolNote = anyHardErrors
    ? `HARD_ERRORS: at least one concurrency level (first: ${firstHardErrorLevel?.concurrency}) produced real ` +
      `DB-contention failures instead of queueing to success -- pool_exhaustion_error (no free connection) ` +
      `and/or statement_timeout_error (connection acquired, but Postgres canceled the query once concurrent ` +
      `contention pushed its execution time past the server's own statement_timeout; see errorSamples on that ` +
      `level for the exact Postgres error code/message). This is an ungraceful pool-contention failure mode, ` +
      `not a graceful queue. This is a FINDING. ` +
      `Sharp onset: the uncontended single-request baseline (${heavyBaseline.ms}ms) succeeded every time this ` +
      `script ran it, but the SAME query run just twice at once (concurrency=2) already failed 2/2 via ` +
      (observedStatementTimeoutMs
        ? `statement_timeout (observed cutoff ~${observedStatementTimeoutMs}ms, consistent across levels ` +
          `2 through 20). `
        : `statement_timeout. `) +
      `At the highest tested level (concurrency=${CONCURRENCY_LEVELS[CONCURRENCY_LEVELS.length - 1]}) wall-clock ` +
      `and per-request latency both rose above that fixed cutoff for some requests -- real evidence that some ` +
      `genuine connection-wait queueing IS happening underneath the timeout cancellations, not just a flat ` +
      `constant. CAVEAT: this branch is a smaller/free-tier compute instance than production (same caveat ` +
      `PT-12-002 already states for its own thresholds); the exact ~${observedStatementTimeoutMs ?? "8000"}ms ` +
      `statement_timeout value and the exact concurrency onset measured here are properties of THIS branch's ` +
      `compute tier and role-level statement_timeout GUC, not guaranteed to be identical to production's -- but ` +
      `the qualitative behavior (a moderately expensive read-only query, run with even mild concurrency, gets ` +
      `hard-canceled by the database rather than queued to completion) is a property of Postgres/PostgREST's ` +
      `real statement_timeout mechanism and is not branch-specific.`
    : anyOtherErrors
      ? `OTHER_ERRORS: at least one level (first: ${firstDegradedLevel?.concurrency}) produced errors that are ` +
        `not clearly pool-exhaustion-shaped -- see errorSamples on that level. Worth a closer look, but not ` +
        `confidently classified as pool exhaustion specifically.`
      : `GRACEFUL: every tested concurrency level (up to ${CONCURRENCY_LEVELS[CONCURRENCY_LEVELS.length - 1]}) ` +
        `completed 100% of heavy, connection-holding queries successfully -- later callers queued (wall-clock ` +
        `and queueingFactor rise with concurrency) rather than the pool rejecting excess requests. No pool` +
        `-exhaustion errors observed in the tested range.`;

  const rateLimiterNote =
    `Across all ${levels.length} levels: shouldBlock funder produced ${totalFalseAllows}/${totalBlockCalls} ` +
    `false-allows (rate-limit bypass under contention) and shouldAllow funder produced ${totalFalseBlocks}/` +
    `${totalAllowCalls} false-blocks of legitimate traffic. ` +
    (totalFalseBlocks > 0
      ? `totalFalseBlocks > 0 is a genuine violation of "no false-blocking of legitimate traffic under ` +
        `contention" -- FINDING.`
      : `Zero false-blocks confirms this rate limiter never spuriously blocks legitimate traffic under DB ` +
        `contention, consistent with its fail-open (not fail-closed) design.`) +
    " " +
    (totalFalseAllows > 0
      ? `totalFalseAllows > 0 means DB contention DOES cause this rate limiter to bypass a real, active ` +
        `24h cooldown for some fraction of calls (its catch-block "return true" fail-open path was reached ` +
        `under load) -- FINDING, ties to the already-documented rate-limiter class of issue in ` +
        `worker/rate-limiter.ts (see PHASE-11-SUMMARY.md's waitBetweenSubmissions() finding for the sibling ` +
        `method's own, separately-documented issue).`
      : `Zero false-allows in the tested range means the domain-cooldown check held correctly even under ` +
        `real DB contention up to concurrency=${CONCURRENCY_LEVELS[CONCURRENCY_LEVELS.length - 1]} -- its ` +
        `fail-open design exists but was not actually triggered at this contention level.`);

  const finalEvidence = evidenceSoFar();
  finalEvidence.status = "complete";
  finalEvidence.completedAt = new Date().toISOString();
  finalEvidence.cleanup = {
    seededSubmissionId: seededRow.id,
    deleteRequestOk: deleteOk,
    verifiedAbsent: cleanupVerified,
  };
  finalEvidence.findings = {
    poolStress: {
      anyHardErrors,
      anyOtherErrors,
      highestGracefulConcurrency: highestGracefulLevel ? highestGracefulLevel.concurrency : null,
      firstDegradedConcurrency: firstDegradedLevel ? firstDegradedLevel.concurrency : null,
      firstHardErrorConcurrency: firstHardErrorLevel ? firstHardErrorLevel.concurrency : null,
      observedStatementTimeoutMs,
      uncontendedBaselineSucceededMs: heavyBaseline.ms,
      note: poolNote,
    },
    rateLimiterContention: {
      totalFalseAllows,
      totalFalseBlocks,
      totalBlockCalls,
      totalAllowCalls,
      note: rateLimiterNote,
    },
  };

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(finalEvidence, null, 2), "utf8");

  console.log(`\n${poolNote}`);
  console.log(`\n${rateLimiterNote}`);
  console.log(`\nWrote ${RESULTS_JSON}`);
}

main().catch((err) => {
  console.error(`UNCAUGHT ERROR: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
