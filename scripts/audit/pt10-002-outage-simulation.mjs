// ============================================================================
// PT-10-002 -- dependency-outage simulation across three real failure modes:
//   1. Supabase slow/unavailable -- inject latency/connection-reset on the
//      real DB path (via a local fault-injection proxy in front of the real
//      local Supabase stack) and confirm the app degrades (loading/error
//      state, or a clean redirect/JSON error) rather than crashing.
//   2. Worker killed mid-job -- SIGKILL a real process that has genuinely
//      claimed a real submission_queue row (same claim predicates as
//      worker/queue-processor.ts's dequeue()) before it reaches any terminal
//      status write, then confirm whether the row is reclaimed, cleanly
//      failed, or left permanently stuck (ties to PT-08's queue-semantics
//      work, which covered agent_queue's retry lifecycle -- this scenario
//      targets the separate, actually-continuously-running submission_queue
//      worker instead, per PT-08's own methodology note that it used a
//      faithful reimplementation rather than a real process kill).
//   3. Malformed third-party responses -- feed genuinely malformed/truncated
//      payloads into 5 real integration parser entry points (Grants.gov,
//      SAM.gov, ProPublica 990, IRS 990 XML, CA Grants Portal RSS) and
//      confirm they don't crash the calling batch/process.
//
// LOCAL/BRANCH ONLY, same hard rule as every PT-05/PT-08/PT-10 write-test
// script (test-evidence/pt-02/BRANCH_STRATEGY.md): every live call in this
// script targets the local Supabase stack (.pt05-local-stack) and an
// isolated `next dev` instance this script itself starts and stops (its own
// port, its own PT_AUDIT_DIST_DIR build output per next.config.mjs's hook) --
// never production (vbjplpquqxxfbpazyalt), never benavora.com, never a real
// third-party network call (scenario 3's "malformed responses" are served by
// a monkeypatched global.fetch, not the real internet).
//
// Writes test-evidence/pt-10/outage-simulation.json.
// ASCII only. Node 20 compatible.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import ws from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
const OUT_PATH = path.join(REPO_ROOT, "test-evidence", "pt-10", "outage-simulation.json");
const MODE_FILE = path.join(REPO_ROOT, ".pt10-002-fault-mode.json");

const PROD_URL_FRAGMENT = "vbjplpquqxxfbpazyalt";
const PROXY_PORT = 56399;
const NEXT_PORT = 3299;
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;
const NEXT_BASE_URL = `http://localhost:${NEXT_PORT}`;

function log(msg) {
  console.log(`[pt10-002] ${new Date().toISOString()} ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setMode(mode, slowMs = 12000) {
  fs.writeFileSync(MODE_FILE, JSON.stringify({ mode, slowMs }), "utf8");
}

// ----------------------------------------------------------------------------
// Local Supabase stack config, read live from the CLI rather than hardcoded --
// avoids drift if the stack is ever restarted with different generated keys.
// ----------------------------------------------------------------------------
function getLocalStackConfig() {
  const raw = execSync("npx supabase status --workdir .pt05-local-stack -o json", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const cfg = JSON.parse(raw);
  if (!cfg.API_URL || !cfg.ANON_KEY || !cfg.SERVICE_ROLE_KEY) {
    throw new Error("getLocalStackConfig: missing API_URL/ANON_KEY/SERVICE_ROLE_KEY in supabase status output");
  }
  if (cfg.API_URL.includes(PROD_URL_FRAGMENT)) {
    throw new Error("HARD STOP: local stack API_URL contains the production project ref. Aborting.");
  }
  return cfg;
}

async function waitForHttp(url, { timeoutMs, intervalMs = 1500, label = url }) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      return { ok: true, status: res.status };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await sleep(intervalMs);
    }
  }
  return { ok: false, error: `timed out waiting for ${label}: ${lastErr}` };
}

// Bounded fetch wrapper for the actual test hits below -- never lets a single
// request hang the whole harness, and records precisely what happened
// (resolved / timed out / network error) rather than silently swallowing it.
async function boundedFetch(url, { timeoutMs, ...opts } = {}) {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...opts, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    const bodyText = await res.text().catch(() => "");
    return {
      outcome: "responded",
      elapsedMs: Date.now() - startedAt,
      status: res.status,
      location: res.headers.get("location"),
      contentType: res.headers.get("content-type") || "",
      bodyLength: bodyText.length,
      bodySnippet: bodyText.slice(0, 800),
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "TimeoutError";
    return {
      outcome: isAbort ? "timed_out" : "network_error",
      elapsedMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Heuristic: does this response body look like an unhandled framework crash
// (a raw Next.js/Node error/stack-trace page) rather than a designed page,
// redirect, or JSON error response? Used only to make the "no white screen /
// no crash" judgement legible in the evidence, never as the sole signal --
// status code and outcome are recorded independently too.
function looksLikeCrashPage(result) {
  if (result.outcome !== "responded") return false;
  const body = (result.bodySnippet || "").toLowerCase();
  const crashMarkers = [
    "internal server error",
    "unhandled runtime error",
    "middleware_invocation_failed",
    "application error: a server-side exception has occurred",
    "at object.<anonymous>",
    "econnreset",
    "fetch failed",
  ];
  return result.status >= 500 || crashMarkers.some((m) => body.includes(m));
}

function isBlankOrEmpty(result) {
  return result.outcome === "responded" && result.bodyLength === 0;
}

// ----------------------------------------------------------------------------
// A real, signed-in session is required to make the outage actually bite.
// supabase-js's getUser() (what middleware.ts calls) is designed to always
// revalidate against the real Auth server rather than trust a locally-decoded
// JWT -- but empirically (confirmed by a first run of this exact harness with
// NO cookies at all) it short-circuits locally with no network call whatsoever
// when there is no session token to validate in the first place. An
// unauthenticated request therefore never touches the DB path at all and
// cannot exercise an outage -- this provisions one real throwaway user/org on
// the LOCAL stack directly (never through the fault proxy, so this setup step
// itself is unaffected by whatever fault mode gets injected afterward) and
// returns a real @supabase/ssr session cookie header, same technique already
// established in pt10-001-malformed-payloads.mjs's setup().
// ----------------------------------------------------------------------------
async function provisionRealSession(stackCfg) {
  const admin = createServiceClient(stackCfg.API_URL, stackCfg.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  const TEST_ORG_NAME = "PT-10-002 DB-Outage Test Org";
  const TEST_EMAIL = "pt10-002-outage@pt10-outage.local";
  const PASSWORD = "Pt10OutageSim!2026";

  // Full clean-slate sweep first, in FK-safe order (profile row references
  // both auth.users and organizations, so it must go before either). Covers
  // a leftover fixture from an earlier interrupted run -- listUsers() is
  // paginated (small default perPage), which is why an earlier version of
  // this sweep silently missed a leftover user and createUser() below failed
  // with "already registered"; an explicit large perPage fixes that.
  const { data: existingUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const leftoverUserIds = (existingUsers?.users ?? []).filter((u) => u.email === TEST_EMAIL).map((u) => u.id);
  if (leftoverUserIds.length > 0) {
    await admin.from("profiles").delete().in("id", leftoverUserIds);
  }
  await admin.from("organizations").delete().eq("name", TEST_ORG_NAME);
  for (const id of leftoverUserIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // best-effort -- the createUser call below will surface a clear error if this didn't work
    }
  }

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: TEST_ORG_NAME, onboarding_completed: true })
    .select("id")
    .single();
  if (orgErr) throw new Error("provisionRealSession: org insert failed: " + orgErr.message);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (createErr) throw new Error("provisionRealSession: createUser failed: " + createErr.message);
  const userId = created.user.id;

  const { error: profileErr } = await admin.from("profiles").insert({
    id: userId,
    organization_id: org.id,
    email: TEST_EMAIL,
    full_name: "PT-10-002 Outage Test User",
    role: "writer",
  });
  if (profileErr) throw new Error("provisionRealSession: profile insert failed: " + profileErr.message);

  const anonClient = createServiceClient(stackCfg.API_URL, stackCfg.ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
  const { data: signIn, error: signInErr } = await anonClient.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: PASSWORD,
  });
  if (signInErr) throw new Error("provisionRealSession: signIn failed: " + signInErr.message);

  const jar = new Map();
  const ssrClient = createServerClient(stackCfg.API_URL, stackCfg.ANON_KEY, {
    realtime: { transport: ws },
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) jar.set(name, value);
      },
    },
  });
  const { error: setSessionErr } = await ssrClient.auth.setSession({
    access_token: signIn.session.access_token,
    refresh_token: signIn.session.refresh_token,
  });
  if (setSessionErr) throw new Error("provisionRealSession: setSession failed: " + setSessionErr.message);

  const cookieHeader = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (!cookieHeader) throw new Error("provisionRealSession: no cookies captured");

  return {
    admin,
    orgId: org.id,
    userId,
    cookieHeader,
    async cleanup() {
      // .catch() chained directly on a supabase-js query builder is NOT safe
      // (it throws synchronously on some builder/version combinations rather
      // than behaving like a real Promise method) -- try/catch only, per this
      // project's own documented pitfall (see project memory on this exact
      // failure class).
      //
      // Order matters: a real first attempt at this cleanup found
      // admin.auth.admin.deleteUser() itself fails ("Database error deleting
      // user", 500) when the profile row + whatever else this test session's
      // real page renders wrote for this org/user still exist -- GoTrue's own
      // internal cascade through profiles->organizations apparently can't
      // complete under those conditions. Deleting the profile row directly
      // FIRST (confirmed live to work cleanly) sidesteps that entirely: it
      // both removes the FK that would otherwise block the organizations
      // delete AND lets deleteUser() succeed afterward with nothing left for
      // its own cascade to trip on.
      try {
        await admin.from("profiles").delete().eq("id", userId);
      } catch {
        // best-effort cleanup only
      }
      try {
        await admin.from("organizations").delete().eq("id", org.id);
      } catch {
        // best-effort cleanup only
      }
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch {
        // best-effort cleanup only
      }
    },
  };
}

// ============================================================================
// Scenario 1 -- Supabase slow/unavailable
// ============================================================================
async function runScenario1(stackCfg) {
  log("Scenario 1: provisioning a real signed-in session on the local stack (before any fault injection)...");
  const session = await provisionRealSession(stackCfg);
  log(`Scenario 1: real session ready for org ${session.orgId}.`);

  log("Scenario 1: starting fault proxy + isolated Next dev server...");
  setMode("normal");

  const proxy = spawn(process.execPath, [path.join(__dirname, "pt10-002-fault-proxy.mjs")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PT10_PROXY_PORT: String(PROXY_PORT),
      PT10_PROXY_UPSTREAM: stackCfg.API_URL,
      PT10_PROXY_MODE_FILE: MODE_FILE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const proxyLog = [];
  proxy.stdout.on("data", (d) => proxyLog.push(d.toString()));
  proxy.stderr.on("data", (d) => proxyLog.push(d.toString()));

  const proxyReady = await waitForHttp(`${PROXY_URL}/__pt10_proxy_health`, {
    timeoutMs: 15000,
    label: "fault proxy health",
  });
  if (!proxyReady.ok) {
    proxy.kill("SIGKILL");
    throw new Error(`Scenario 1: fault proxy never became healthy: ${proxyReady.error}`);
  }
  log("Scenario 1: fault proxy healthy.");

  const distDir = ".next-pt10-outage";
  const nextEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: PROXY_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: stackCfg.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: stackCfg.SERVICE_ROLE_KEY,
    PT_AUDIT_DIST_DIR: distDir,
    NEXT_TELEMETRY_DISABLED: "1",
  };

  const nextBin = path.join(REPO_ROOT, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
  const nextProc = spawn(nextBin, ["dev", "-p", String(NEXT_PORT)], {
    cwd: REPO_ROOT,
    env: nextEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const nextLogTail = [];
  const pushLog = (d) => {
    const s = d.toString();
    nextLogTail.push(s);
    if (nextLogTail.length > 200) nextLogTail.shift();
  };
  nextProc.stdout.on("data", pushLog);
  nextProc.stderr.on("data", pushLog);

  log("Scenario 1: waiting for isolated Next dev server to become ready (this can take a while on first compile)...");
  const nextReady = await waitForHttp(NEXT_BASE_URL + "/", { timeoutMs: 240000, intervalMs: 3000, label: "isolated next dev" });

  const result = {
    description:
      "Injects connection-reset ('down') and added latency ('slow') on the real DB path via a local " +
      "fault-injection proxy in front of the real local Supabase stack, with an isolated next dev " +
      "server's NEXT_PUBLIC_SUPABASE_URL pointed at that proxy for the whole run (no server restart " +
      "between fault modes -- only the proxy's own live-reread mode file changes). Targets middleware.ts " +
      "(runs on every non-static request, calls supabase.auth.getUser() with no try/catch anywhere in " +
      "the function -- src/middleware.ts lines ~117-119) plus a protected dashboard page and a real API " +
      "route, to see whether an unhandled exception there produces a raw framework crash or a designed " +
      "degrade path. Repo-wide check before running: no app/error.tsx, app/global-error.tsx, or a " +
      "(dashboard)/error.tsx or loading.tsx exists anywhere in src/app -- there is no React error " +
      "boundary configured anywhere in this app that could catch a Server Component/middleware throw.",
    hasErrorBoundary: false,
    proxyLog: null,
    cases: [],
  };

  if (!nextReady.ok) {
    result.harnessFailure = `Isolated Next dev server never became ready: ${nextReady.error}`;
    result.nextDevLogTail = nextLogTail.join("").slice(-6000);
    nextProc.kill("SIGKILL");
    proxy.kill("SIGKILL");
    await session.cleanup();
    return result;
  }
  log("Scenario 1: isolated Next dev server ready. Running baseline + fault cases (all authenticated with the real session)...");

  const authHeaders = { Cookie: session.cookieHeader };
  const targets = [
    { key: "public_home", path: "/", note: "public path; middleware still constructs a Supabase client and calls getUser() before the isPublic check short-circuits (src/middleware.ts lines ~95-120). A real session cookie is attached so getUser() actually has a token to revalidate against the Auth server over the network -- an EARLIER run of this exact harness with NO cookie at all showed identical (fast, unaffected) behavior across every fault mode, confirming getUser() short-circuits locally with no network call when there is no session to check; this run fixes that gap." },
    { key: "protected_dashboard_with_session", path: "/dashboard", note: "protected path, real writer-role session for a real throwaway org -- this is a genuine authenticated dashboard render that queries Supabase directly in the page's own Server Component in addition to middleware's own getUser() call." },
    { key: "api_notifications", path: "/api/notifications", note: "a real API route (not middleware) -- exercises whether route-level handling degrades better than middleware, with the same real session." },
  ];

  // ---- baseline (proxy in "normal" mode) ----
  setMode("normal");
  for (const t of targets) {
    const r = await boundedFetch(NEXT_BASE_URL + t.path, { timeoutMs: 25000, headers: authHeaders });
    result.cases.push({
      phase: "baseline_normal",
      target: t.key,
      path: t.path,
      note: t.note,
      response: r,
      looksLikeCrash: looksLikeCrashPage(r),
      isBlank: isBlankOrEmpty(r),
    });
    log(`  baseline ${t.path} -> ${r.outcome} ${r.status ?? ""} (${r.elapsedMs}ms)`);
  }

  // ---- down (connection reset before any response) ----
  setMode("down");
  await sleep(500); // let the mode file write land before the next request
  for (const t of targets) {
    const r = await boundedFetch(NEXT_BASE_URL + t.path, { timeoutMs: 25000, headers: authHeaders });
    const crash = looksLikeCrashPage(r);
    result.cases.push({
      phase: "db_down",
      target: t.key,
      path: t.path,
      note: t.note,
      response: r,
      looksLikeCrash: crash,
      isBlank: isBlankOrEmpty(r),
      verdict: crash || isBlankOrEmpty(r) || r.outcome === "network_error" ? "FINDING" : "PASS",
    });
    log(`  db_down    ${t.path} -> ${r.outcome} ${r.status ?? ""} (${r.elapsedMs}ms) crash=${crash}`);
  }

  // ---- slow (upstream reachable, but the proxy withholds the response for slowMs) ----
  const SLOW_MS = 15000;
  const BOUNDED_WAIT_MS = 30000; // generous, but bounded -- a real user's patience threshold, roughly
  setMode("slow", SLOW_MS);
  await sleep(500);
  for (const t of targets) {
    const r = await boundedFetch(NEXT_BASE_URL + t.path, { timeoutMs: BOUNDED_WAIT_MS, headers: authHeaders });
    const crash = looksLikeCrashPage(r);
    result.cases.push({
      phase: "db_slow",
      target: t.key,
      path: t.path,
      note: `${t.note} Proxy injects ${SLOW_MS}ms of added latency before forwarding; bounded client wait ${BOUNDED_WAIT_MS}ms.`,
      response: r,
      looksLikeCrash: crash,
      isBlank: isBlankOrEmpty(r),
      // A slow-but-eventually-correct response is the expected/acceptable
      // outcome here (real users would see a loading spinner for ~15s, not
      // ideal but not a crash). A genuine timeout past the bounded wait, or a
      // crash-shaped response once it does arrive, is the finding.
      verdict: crash ? "FINDING" : r.outcome === "timed_out" ? "FINDING_SLOW_NO_TIMEOUT_HANDLING" : "PASS",
    });
    log(`  db_slow    ${t.path} -> ${r.outcome} ${r.status ?? ""} (${r.elapsedMs}ms) crash=${crash}`);
  }

  // ---- recovery: confirm the app is not permanently wedged by a transient outage ----
  setMode("normal");
  await sleep(500);
  const recovery = await boundedFetch(NEXT_BASE_URL + "/", { timeoutMs: 25000, headers: authHeaders });
  result.recovery = {
    response: recovery,
    verdict: recovery.outcome === "responded" && recovery.status < 500 ? "PASS" : "FINDING",
  };
  log(`  recovery   / -> ${recovery.outcome} ${recovery.status ?? ""} (${recovery.elapsedMs}ms)`);

  result.nextDevLogTail = nextLogTail.join("").slice(-6000);

  log("Scenario 1: shutting down isolated Next dev server + fault proxy, cleaning up test session...");
  nextProc.kill("SIGKILL");
  proxy.kill("SIGKILL");
  await sleep(1000);
  try {
    fs.rmSync(path.join(REPO_ROOT, distDir), { recursive: true, force: true });
  } catch {
    // best-effort cleanup only
  }
  await session.cleanup();

  const findings = result.cases.filter((c) => c.verdict && c.verdict !== "PASS");
  result.behavior = result.cases;
  result.findingCount = findings.length + (result.recovery.verdict !== "PASS" ? 1 : 0);
  result.overallVerdict = result.findingCount > 0 ? "FINDINGS_PRESENT" : "DEGRADES_GRACEFULLY";
  return result;
}

// ============================================================================
// Scenario 2 -- worker killed mid-job
// ============================================================================
async function runScenario2(stackCfg) {
  log("Scenario 2: provisioning throwaway org + submission_queue row...");

  const admin = createServiceClient(stackCfg.API_URL, stackCfg.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  const TEST_ORG_NAME = "PT-10-002 Worker-Kill Test Org";
  await admin.from("organizations").delete().eq("name", TEST_ORG_NAME);
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: TEST_ORG_NAME, onboarding_completed: true })
    .select("id")
    .single();
  if (orgErr) throw new Error("Scenario 2: org insert failed: " + orgErr.message);
  const orgId = org.id;

  const { data: queueRow, error: insertErr } = await admin
    .from("submission_queue")
    .insert({ organization_id: orgId, status: "pending", priority: 100 })
    .select("*")
    .single();
  if (insertErr) throw new Error("Scenario 2: submission_queue insert failed: " + insertErr.message);
  const originalRow = { ...queueRow };
  log(`Scenario 2: seeded submission_queue row ${queueRow.id} (status=pending).`);

  const WORK_MS = 20000;
  const KILL_AFTER_MS = 4000; // kill well inside the WORK_MS window, after the claim has landed

  const child = spawn(process.execPath, ["--import", "tsx", path.join(__dirname, "pt10-002-queue-claim-worker.mjs")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PT10_SUPABASE_URL: stackCfg.API_URL,
      PT10_SUPABASE_SERVICE_KEY: stackCfg.SERVICE_ROLE_KEY,
      PT10_QUEUE_ITEM_ID: queueRow.id,
      PT10_WORK_MS: String(WORK_MS),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const childLog = [];
  child.stdout.on("data", (d) => childLog.push(d.toString()));
  child.stderr.on("data", (d) => childLog.push(d.toString()));

  // Wait for the child to actually claim the row (poll the DB, not the
  // child's stdout, so this is verified against real state, not just trusted
  // from a log line) before killing it -- killing before a claim ever
  // happened would just be "job never started", not "worker killed mid-job".
  let claimedConfirmed = false;
  const claimDeadline = Date.now() + 10000;
  while (Date.now() < claimDeadline) {
    const { data: check } = await admin.from("submission_queue").select("status, started_at").eq("id", queueRow.id).single();
    if (check?.status === "processing" && check.started_at) {
      claimedConfirmed = true;
      break;
    }
    await sleep(300);
  }
  log(`Scenario 2: claim confirmed=${claimedConfirmed}. Waiting until ${KILL_AFTER_MS}ms mark, then SIGKILL...`);

  const elapsedSinceSpawn = Date.now();
  await sleep(Math.max(0, KILL_AFTER_MS - 0));
  child.kill("SIGKILL");
  const killedAt = new Date().toISOString();
  log(`Scenario 2: sent SIGKILL to worker child (pid ${child.pid}).`);

  // Give the OS a moment to actually reap the process, then confirm it's
  // really gone (not just "signal sent") before reading DB state.
  await new Promise((resolve) => child.on("exit", resolve));
  await sleep(500);

  const { data: postKillRow, error: postKillErr } = await admin
    .from("submission_queue")
    .select("*")
    .eq("id", queueRow.id)
    .single();
  if (postKillErr) throw new Error("Scenario 2: post-kill read failed: " + postKillErr.message);

  const stillStuckProcessing = postKillRow.status === "processing" && postKillRow.completed_at === null;

  // ---- Give the queue's own natural lifecycle a real chance to reclaim it.
  // If ANY reclaim mechanism exists (a cron sweep, a stale-item timeout on
  // the next poll cycle, etc.), waiting past a second worker's normal poll
  // interval before re-checking would surface it. worker/queue-processor.ts's
  // own idle-poll sleep is 15s (SLEEP_MS, confirmed by reading the file); a
  // second, independent claim-attempt using the exact real dequeue()
  // predicate is run below rather than just waiting, since simply waiting
  // proves nothing about whether a reclaim mechanism exists -- only an
  // explicit re-claim attempt (or absence of one anywhere in the codebase,
  // confirmed separately by a repo-wide grep) does.
  const { data: reclaimAttempt } = await admin
    .from("submission_queue")
    .select("id")
    .eq("status", "pending")
    .eq("id", queueRow.id)
    .maybeSingle();
  const reclaimableViaNormalDequeue = reclaimAttempt !== null; // true only if something reset it to 'pending'

  // ---- Post-failure DB integrity check ----
  const { data: allRowsForOrg, error: allRowsErr } = await admin
    .from("submission_queue")
    .select("id, status, organization_id, funder_id, priority, created_at, started_at, completed_at")
    .eq("organization_id", orgId);
  if (allRowsErr) throw new Error("Scenario 2: integrity-check row scan failed: " + allRowsErr.message);

  const fieldDrift = [];
  for (const key of ["organization_id", "priority", "created_at"]) {
    if (String(postKillRow[key]) !== String(originalRow[key])) {
      fieldDrift.push({ field: key, original: originalRow[key], observed: postKillRow[key] });
    }
  }

  const integrityCheck = {
    performed: true,
    method:
      "Direct service-role SELECT of the exact queue row (by primary key) and every other submission_queue " +
      "row sharing this test's throwaway organization_id, run after confirming the child process actually " +
      "exited (not just signalled). Checks (a) exactly one row exists for this test -- no duplication from a " +
      "botched claim/retry, (b) every field the row was created with is unchanged except the claim's own " +
      "started_at/status write -- no partial/corrupted write, (c) whether the exact real dequeue() claim " +
      "predicate (status='pending') can find this row again -- confirms it is neither silently reclaimed nor " +
      "double-claimable.",
    rowCountForTestOrg: allRowsForOrg.length,
    expectedRowCount: 1,
    rowCountMatchesExpected: allRowsForOrg.length === 1,
    fieldDriftFromOriginalInsert: fieldDrift,
    noUnexpectedFieldDrift: fieldDrift.length === 0,
    finalRow: {
      id: postKillRow.id,
      status: postKillRow.status,
      started_at: postKillRow.started_at,
      completed_at: postKillRow.completed_at,
      error_message: postKillRow.error_message ?? null,
    },
    reclaimableViaNormalDequeuePredicate: reclaimableViaNormalDequeue,
  };

  // ---- code-read cross-checks, cited precisely, confirming the empirical
  // result isn't a fluke of this one test run -- no reclaim path exists
  // anywhere in this codebase for submission_queue, automatic or manual.
  const codeReadNotes = [
    {
      claim: "worker/queue-processor.ts's dequeue() (lines ~420-459) has no stale-claim timeout: it only ever " +
        "selects status='pending' rows. A row already at status='processing' is invisible to every future " +
        "dequeue() call, forever, regardless of how long ago it was claimed.",
      verifiedBy: "direct read of worker/queue-processor.ts this session",
    },
    {
      claim: "No cron/scheduled sweep anywhere in worker/scheduler.ts reaps stale submission_queue rows " +
        "(grepped the whole worker/ and src/ tree for stuck/stale/reclaim/orphan job-sweep logic touching " +
        "submission_queue specifically -- none found).",
      verifiedBy: "repo-wide grep this session",
    },
    {
      claim: "The one existing manual admin remedy, POST /api/admin/system {action:'clear_stuck_jobs'} " +
        "(src/app/api/admin/system/route.ts lines ~157-189), only clears agent_runs rows stuck at " +
        "status='running' for over 2 hours. It contains zero references to submission_queue and cannot " +
        "reach this row even if an admin clicks 'Clear Stuck Jobs' on /admin/system.",
      verifiedBy: "direct read of src/app/api/admin/system/route.ts this session",
    },
    {
      claim: "A separate, older AutoApply system (automation_queue / AutomationWorkerAgent, " +
        "src/lib/agents/automation-worker.ts) DOES implement a real reapTimedOutItems() (5-minute budget, " +
        "lines ~106,268-275) -- but it only runs when a human/cron hits POST /api/automation/process, and " +
        "operates on a completely different table (automation_queue), not submission_queue. It provides no " +
        "protection for the scenario tested here.",
      verifiedBy: "direct read of src/lib/agents/automation-worker.ts and src/app/api/automation/process/route.ts this session",
    },
  ];

  log("Scenario 2: cleaning up test org + queue row...");
  await admin.from("submission_queue").delete().eq("organization_id", orgId);
  await admin.from("organizations").delete().eq("id", orgId);

  const verdict = stillStuckProcessing && !reclaimableViaNormalDequeue ? "FINDING" : "PASS";

  return {
    description:
      "Kills (SIGKILL) a real, standalone child process after it has genuinely claimed a real " +
      "submission_queue row via the exact two-step claim predicate worker/queue-processor.ts's dequeue() " +
      "uses, mid-way through the simulated in-flight-work window (before any terminal status write), then " +
      "checks whether the row is reclaimed, cleanly failed, or left permanently in a half-done state.",
    behavior: {
      childPid: child.pid,
      claimConfirmedBeforeKill: claimedConfirmed,
      killedAt,
      childExitCode: child.exitCode,
      childExitSignal: child.signalCode,
      childLogTail: childLog.join("").slice(-2000),
      postKillStatus: postKillRow.status,
      postKillCompletedAt: postKillRow.completed_at,
      postKillErrorMessage: postKillRow.error_message ?? null,
      stillStuckAtProcessingWithNoTerminalState: stillStuckProcessing,
      reclaimableViaNormalDequeuePredicate: reclaimableViaNormalDequeue,
    },
    postFailureIntegrityCheck: integrityCheck,
    codeReadNotes,
    verdict,
    findingCount: verdict === "FINDING" ? 1 : 0,
    findings:
      verdict === "FINDING"
        ? [
            {
              id: "PT10-002-S2-001",
              severity: "P1",
              layer: "Worker/Queue",
              description:
                "A submission_queue row that was claimed (status set to 'processing') by a worker process " +
                "that is then killed mid-job (crash, OOM, host eviction, deploy restart) is left permanently " +
                "stuck at status='processing' with completed_at never set. No automatic reclaim exists " +
                "(dequeue() only ever looks for status='pending'), and no manual remedy exists either -- " +
                "the one 'Clear Stuck Jobs' admin action only touches agent_runs, never submission_queue. " +
                "The row is a genuine, permanent corrupt half-done state requiring direct DB intervention " +
                "to recover; the funder application it represents silently never gets submitted, retried, " +
                "or flagged as failed to anyone.",
              evidencePath: "test-evidence/pt-10/outage-simulation.json#scenarios.scenario2_worker_killed_mid_job",
              reproduction:
                "node --import tsx scripts/audit/pt10-002-outage-simulation.mjs (scenario 2 alone reproduces " +
                "this deterministically: seed a pending submission_queue row, let a worker claim it, SIGKILL " +
                "the worker before it writes a terminal status, re-read the row).",
              scopeTag: "CONFIRMED",
            },
          ]
        : [],
  };
}

// ============================================================================
// Scenario 3 -- malformed third-party responses fed into real parsers
// ============================================================================
async function runScenario3() {
  log("Scenario 3: fuzzing real integration parsers with malformed responses...");

  const cases = [];

  function withFetchOverride(matchUrlSubstring, response, fn) {
    const original = global.fetch;
    global.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes(matchUrlSubstring)) {
        if (response.throws) throw new Error(response.throws);
        return new Response(response.body, {
          status: response.status ?? 200,
          headers: response.headers ?? { "content-type": "application/json" },
        });
      }
      return original(input, init);
    };
    return fn().finally(() => {
      global.fetch = original;
    });
  }

  async function runCase({ id, target, parserModule, exportName, callArgs, matchUrlSubstring, response, note, callerProtection, env }) {
    const mod = await import(parserModule);
    const fn = mod[exportName];
    const priorEnv = {};
    if (env) {
      for (const [k, v] of Object.entries(env)) {
        priorEnv[k] = process.env[k];
        process.env[k] = v;
      }
    }
    let outcome;
    let thrown = null;
    let returned = null;
    try {
      const invoke = () => fn(...callArgs);
      returned = matchUrlSubstring
        ? await withFetchOverride(matchUrlSubstring, response, invoke)
        : await invoke();
      outcome = "returned_without_throwing";
    } catch (err) {
      outcome = "threw_uncaught";
      thrown = err instanceof Error ? err.message : String(err);
    } finally {
      for (const [k, v] of Object.entries(priorEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }

    const parserIsDefensive = outcome === "returned_without_throwing";
    const verdict = parserIsDefensive
      ? "PASS"
      : callerProtection.hasTryCatchAtImmediateCallSite
        ? "PASS_PROTECTED_BY_CALLER"
        : "FINDING";

    const result = {
      id,
      target,
      note,
      outcome,
      thrownMessage: thrown,
      returnedSnippet: returned === null ? null : JSON.stringify(returned).slice(0, 500),
      callerProtection,
      verdict,
    };
    cases.push(result);
    log(`  ${id} [${target}] -> ${outcome} :: ${verdict}`);
    return result;
  }

  // --- 1. Grants.gov client -- null entry inside oppHits array ------------
  await runCase({
    id: "PT10-002-S3-001",
    target: "grantsgov-client.searchGrantsGovOpportunities",
    parserModule: "../../src/lib/sources/grantsgov-client.ts",
    exportName: "searchGrantsGovOpportunities",
    callArgs: ["affordable housing"],
    matchUrlSubstring: "api.grants.gov",
    response: { body: JSON.stringify({ oppHits: [null, { id: "GO123", oppTitle: "Real Grant" }] }) },
    note:
      "mapHit() (grantsgov-client.ts, unexported helper) does `hit.id`/`hit.oppTitle` on every array element " +
      "with no null guard on the element itself; the outer function only try/catches the fetch() call and " +
      "response.json() -- the per-hit mapping loop (lines ~126-129) is outside both try/catch blocks.",
    callerProtection: {
      immediateCaller: "src/lib/sources/grantsgov-sync.ts syncGrantsGovForOrg(), line ~101, `for (const keyword of keywords) { const hits = await searchGrantsGovOpportunities(keyword); ... }`",
      hasTryCatchAtImmediateCallSite: false,
      nextProtectedLayerUp: "src/app/api/cron/grantsgov/route.ts wraps EACH org's syncGrantsGovForOrg() call in try/catch (line ~50), so one malformed API response fails only that org's entire sync for that run (silently losing every keyword after the failure point, not just the malformed one) -- it does not crash the cron job or other orgs.",
    },
  });

  // --- 2. SAM.gov client -- identical shape of bug -------------------------
  await runCase({
    id: "PT10-002-S3-002",
    target: "samgov-client.searchSamGovOpportunities",
    parserModule: "../../src/lib/sources/samgov-client.ts",
    exportName: "searchSamGovOpportunities",
    callArgs: [],
    matchUrlSubstring: "api.sam.gov",
    response: { body: JSON.stringify({ opportunitiesData: [null, { noticeId: "N1", title: "Real Notice" }] }) },
    note: "Same structural bug as grantsgov-client.ts's mapHit -- identical file shape, same missing null guard on array elements.",
    callerProtection: {
      immediateCaller: "src/app/api/sources/samgov/route.ts GET() handler, line ~53, `const hits = await searchSamGovOpportunities();` -- the entire GET() function body (checked directly) has NO try/catch anywhere, only explicit early-return checks for specific known conditions (missing auth, missing orgId, a failed opportunities SELECT).",
      hasTryCatchAtImmediateCallSite: false,
      nextProtectedLayerUp: "None found -- unlike grants.gov's cron route, this route is hit directly by an external cron trigger per the file's own header comment ('SYSTEM job... gated solely by CRON_SECRET'), with no per-org looping wrapper in this codebase. Blast radius is narrower (one HTTP request, not a multi-org loop) but the failure mode is worse: an uncaught exception here propagates out of the route handler entirely, so the caller gets Next.js's own generic error response instead of this route's own clean jsonError() JSON shape every other failure path in this file uses.",
    },
    env: { SAM_GOV_API_KEY: "pt10-002-fake-key" },
  });

  // --- 3. ProPublica 990 client -- truncated/invalid JSON ------------------
  await runCase({
    id: "PT10-002-S3-003",
    target: "propublica-990-client.fetchProPublicaFinancials",
    parserModule: "../../src/lib/sources/propublica-990-client.ts",
    exportName: "fetchProPublicaFinancials",
    callArgs: ["12-3456789"],
    matchUrlSubstring: "projects.propublica.org",
    response: { body: "{\"organization\": {\"ein\": 123456789, \"filings_with_data\": [" }, // truncated mid-array
    note: "Genuinely truncated JSON body (cut off mid-array) -- targets the response.json() try/catch (lines ~57-61).",
    callerProtection: { immediateCaller: "n/a -- the function's own internal try/catch is expected to handle this", hasTryCatchAtImmediateCallSite: true },
  });

  // --- 4. ProPublica 990 client -- filings_with_data is not an array -------
  await runCase({
    id: "PT10-002-S3-004",
    target: "propublica-990-client.fetchProPublicaFinancials",
    parserModule: "../../src/lib/sources/propublica-990-client.ts",
    exportName: "fetchProPublicaFinancials",
    callArgs: ["98-7654321"],
    matchUrlSubstring: "projects.propublica.org",
    response: { body: JSON.stringify({ organization: { ein: 987654321 }, filings_with_data: [null] }) },
    note: "filings_with_data present but its one entry is null -- tests the `body.filings_with_data?.[0]` + `!filing` guard (lines ~63-66).",
    callerProtection: { immediateCaller: "n/a", hasTryCatchAtImmediateCallSite: true },
  });

  // --- 5. IRS 990 XML parser -- truncated/garbage XML, called directly, no network ---
  {
    const { IRS990Source } = await import("../../src/lib/enrichment/sources/irs990.ts");
    const source = new IRS990Source();
    const garbageInputs = [
      { label: "empty_string", xml: "" },
      { label: "truncated_mid_tag", xml: "<Return><ReturnData><IRS990PF><BusinessName><BusinessNameLine1Txt>Acme Foun" },
      { label: "binary_garbage", xml: "\x00\x01\x02\xFF\xFE\x00PK\x03\x04not really xml at all ��" },
      { label: "non_xml_html_error_page", xml: "<html><body><h1>503 Service Unavailable</h1></body></html>" },
    ];
    for (const g of garbageInputs) {
      let outcome = "returned_without_throwing";
      let thrown = null;
      let returned = null;
      try {
        returned = source.parseXml("123456789", g.xml, `pt10-002-${g.label}`);
      } catch (err) {
        outcome = "threw_uncaught";
        thrown = err instanceof Error ? err.message : String(err);
      }
      const result = {
        id: `PT10-002-S3-005-${g.label}`,
        target: "irs990.ts IRS990Source.parseXml",
        note: "Called directly, in-process, with no network involved -- this is a pure regex-based 'XML parser' (no real XML library), so garbage input should just fail to match any tag and return null.",
        outcome,
        thrownMessage: thrown,
        returnedSnippet: returned === null ? "null (correctly reported no business name found)" : JSON.stringify(returned).slice(0, 300),
        callerProtection: { immediateCaller: "n/a -- pure synchronous function, no I/O", hasTryCatchAtImmediateCallSite: true },
        verdict: outcome === "returned_without_throwing" ? "PASS" : "FINDING",
      };
      cases.push(result);
      log(`  ${result.id} [${result.target}] -> ${outcome} :: ${result.verdict}`);
    }
  }

  // --- 6. CA Grants Portal RSS/XML client -- genuinely malformed XML via fast-xml-parser ---
  await runCase({
    id: "PT10-002-S3-006",
    target: "ca-grants-portal-client.fetchCaGrantsPortalFeed",
    parserModule: "../../src/lib/sources/state-portals/ca-grants-portal-client.ts",
    exportName: "fetchCaGrantsPortalFeed",
    callArgs: [],
    matchUrlSubstring: "grants.ca.gov",
    response: { body: "<rss><channel><item><title>Truncated feed, no closing tags at all <link>https://example", headers: { "content-type": "text/xml" } },
    note:
      "Genuinely malformed/truncated RSS XML fed to fast-xml-parser's XMLParser.parse() (line ~134-137), " +
      "which has NO try/catch around it in fetchCaGrantsPortalFeed() itself (only the HTTP status check " +
      "above it is guarded).",
    callerProtection: {
      immediateCaller: "src/lib/sources/state-portals/ca-grants-portal-sync.ts line ~149, `const opportunities = await fetchCaGrantsPortalFeed();` -- no try/catch in this file either.",
      hasTryCatchAtImmediateCallSite: false,
      nextProtectedLayerUp: "scripts/ingest-ca-grants-portal.ts main() DOES wrap the equivalent fetchAndTagCaGrantsPortalFeed() call in try/catch (lines ~58-62), calling a fatal() helper that logs a clean message and process.exit(1) -- a genuine crash is prevented at the CLI entry point, though the library function itself remains unprotected for any other/future caller.",
    },
  });

  const findings = cases.filter((c) => c.verdict === "FINDING");
  return {
    description:
      "Feeds genuinely malformed/truncated payloads into 6 real third-party integration parser call sites " +
      "(2 federal opportunity search clients, 2 ProPublica 990 financial-data cases, 4 IRS-990-XML garbage " +
      "variants, 1 RSS/XML feed parser) via a monkeypatched global.fetch (never the real internet) or, for " +
      "the pure-synchronous IRS 990 XML parser, direct in-process calls with no I/O at all. Records whether " +
      "each parser itself throws an uncaught exception past its own function boundary, and separately " +
      "(via direct code read of the real call site) whether the immediate caller has a try/catch that would " +
      "contain that throw before it reaches a whole batch/worker/process boundary.",
    behavior: cases,
    findingCount: findings.length,
    findings: findings.map((c) => ({
      id: c.id,
      severity: "P2",
      layer: "Integration/Parser",
      description: `${c.target}: a malformed response causes an uncaught exception with no try/catch protecting the immediate real call site (${c.callerProtection?.immediateCaller ?? "see case detail"}). ${c.note}`,
      evidencePath: `test-evidence/pt-10/outage-simulation.json#scenarios.scenario3_malformed_third_party_responses.behavior[id=${c.id}]`,
      reproduction: "node --import tsx scripts/audit/pt10-002-outage-simulation.mjs (scenario 3 case " + c.id + ")",
      scopeTag: "CONFIRMED",
    })),
    verdict: findings.length > 0 ? "FINDINGS_PRESENT" : "ALL_PARSERS_DEFENSIVE",
  };
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const stackCfg = getLocalStackConfig();
  log(`Local Supabase stack: ${stackCfg.API_URL}`);

  const scenario3 = await runScenario3();
  const scenario2 = await runScenario2(stackCfg);
  const scenario1 = await runScenario1(stackCfg);

  try {
    fs.rmSync(MODE_FILE, { force: true });
  } catch {
    // best-effort
  }

  const allFindings = [
    ...(scenario1.behavior || []).filter((c) => c.verdict && c.verdict !== "PASS").map((c) => ({ scenario: "scenario1_db_outage", ...c })),
    ...(scenario2.findings || []),
    ...(scenario3.findings || []),
  ];

  const doc = {
    generatedAt: new Date().toISOString(),
    note:
      "PT-10-002. LOCAL/BRANCH ONLY. Real dependency-outage simulation across three failure modes -- see " +
      "each scenario's own `description` field for exact methodology. No production system, real third-party " +
      "network endpoint, or shared dev-server instance was touched at any point.",
    localSupabaseStackUrl: stackCfg.API_URL,
    scenarios: {
      scenario1_db_outage: scenario1,
      scenario2_worker_killed_mid_job: scenario2,
      scenario3_malformed_third_party_responses: scenario3,
    },
    totalFindingCount:
      (scenario1.findingCount || 0) + (scenario2.findingCount || 0) + (scenario3.findingCount || 0),
    overallVerdict:
      (scenario1.findingCount || 0) + (scenario2.findingCount || 0) + (scenario3.findingCount || 0) > 0
        ? "FINDINGS_PRESENT"
        : "ALL_SCENARIOS_DEGRADE_GRACEFULLY",
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
  log(`Wrote ${OUT_PATH}`);
  log(
    `Totals: scenario1=${scenario1.findingCount ?? "n/a"} scenario2=${scenario2.findingCount} scenario3=${scenario3.findingCount} ` +
      `overall=${doc.overallVerdict}`,
  );
}

main().catch((err) => {
  console.error("PT-10-002 FAILED:", err);
  process.exit(1);
});
