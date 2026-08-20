// PT-10-003 -- register findings from PT-10-002's dependency-outage simulation
// (test-evidence/pt-10/outage-simulation.json). PT-10-001's own findings were already
// registered as WGR-121/WGR-122 by the prior session; this appends the outage-simulation
// findings that were never given register rows, continuing numbering from WGR-122.
// ASCII only. Node 20 compatible.

import { appendFindingRow } from "./evidence-lib.mjs";

// -- Scenario 1: full DB outage (db_down) -- degrades cleanly. CONFIRMED-OK -----------------
appendFindingRow({
  id: "WGR-123",
  layer: "Middleware/Availability",
  severity: "P3",
  description:
    "PT-10-002 scenario 1 (db_down phase): a hard Supabase outage (connection reset injected via " +
    "a local fault-injection proxy in front of the real local Supabase stack) was probed against " +
    "3 real targets (public /, protected /dashboard with a real authenticated session, and a real " +
    "API route GET /api/notifications) plus a post-outage recovery check. All 3 degrade cleanly, " +
    "not a crash: the public path renders unaffected (src/middleware.ts's getUser() call, lines " +
    "~117-119, which has zero try/catch anywhere in the function, resolves to a null user via the " +
    "Supabase client library's own internal handling rather than throwing, so isPublicPath()'s " +
    "short-circuit still lets the request through); both /dashboard and /api/notifications " +
    "correctly 307-redirect to /login (same getUser()-returns-null-user path, correctly treated " +
    "as 'not authenticated' rather than crashing). No raw framework crash, no white-screen/blank " +
    "body (isBlank:false on every case, looksLikeCrash:false on every db_down case), no partial or " +
    "malformed HTML in any response body. A recovery probe run immediately after the outage ended " +
    "confirmed the app was not left in any wedged state -- the same clean 404 response as the " +
    "pre-outage baseline. One latent risk noted, not itself a live finding: this app has zero " +
    "React error boundaries anywhere (no app/error.tsx, app/global-error.tsx, or any " +
    "(dashboard)/error.tsx -- confirmed by a repo-wide search before this scenario ran). The clean " +
    "degrade observed here works because supabase-js's own client-side handling in getUser() " +
    "happens to swallow a connection failure into a null-user result rather than throwing; a " +
    "different failure mode that DOES throw past a Server Component render boundary would have " +
    "nothing configured anywhere in this app to catch it.",
  evidencePath:
    "test-evidence/pt-10/outage-simulation.json#scenarios.scenario1_db_outage.cases[] " +
    "(phase==\"db_down\"), and .recovery",
  reproduction:
    "node --import tsx scripts/audit/pt10-002-outage-simulation.mjs (scenario 1 reproduces the " +
    "db_down phase deterministically via the fault proxy's connection-reset mode); node " +
    "scripts/audit/verify-pt10-002.mjs.",
  scopeTag: "CONFIRMED-OK",
});

// -- Scenario 1: sustained DB latency (db_slow) -- no timeout anywhere. CONFIRMED-BROKEN -----
appendFindingRow({
  id: "WGR-124",
  layer: "Middleware/Availability",
  severity: "P1",
  description:
    "PT-10-002 scenario 1 (db_slow phase, +15000ms latency injected before the fault proxy " +
    "forwards to the real local Supabase stack, harness-bounded client wait 30000ms): the public " +
    "path (/) survived the full ~15.2s round trip and still returned its normal 404 response " +
    "(elapsedMs 15169, matching the injected delay almost exactly) -- but both /dashboard (a real " +
    "authenticated Server Component page) and /api/notifications (a real API route) never resolved " +
    "at all, hitting the harness's own 30-second bounded wait and aborting with 'The operation was " +
    "aborted due to timeout' (elapsedMs ~30003-30006 on both). Root cause, from a direct code read: " +
    "neither src/lib/supabase/server.ts nor admin.ts configures any fetch-level timeout/AbortSignal " +
    "on the Supabase client, and no query anywhere in middleware.ts or the dashboard/notifications " +
    "code paths sets a Postgres statement_timeout or wraps its own await in a bounded race. The two " +
    "failing targets both make TWO serial network round trips through the slow path per request -- " +
    "middleware's own getUser() call (which runs on every non-public request) plus the page's/ " +
    "route's own separate Supabase query -- compounding the injected 15s latency to roughly 30s+, " +
    "which is consistent with why they cross the harness's bound while the public path (one round " +
    "trip only) does not. Net effect: a genuinely slow-but-not-fully-down database dependency " +
    "produces the same practical outcome to a real user as a full outage -- an indefinite hang with " +
    "no error message, no loading/retry UI, and no bounded fast-fail anywhere in the stack -- rather " +
    "than a designed degrade path. This is a worse outcome than WGR-123's clean db_down case, which " +
    "at least resolves quickly.",
  evidencePath:
    "test-evidence/pt-10/outage-simulation.json#scenarios.scenario1_db_outage.cases[] " +
    "(phase==\"db_slow\", target in [\"protected_dashboard_with_session\",\"api_notifications\"])",
  reproduction:
    "node --import tsx scripts/audit/pt10-002-outage-simulation.mjs (scenario 1 reproduces the " +
    "db_slow phase deterministically via the fault proxy's own live-reread latency-injection mode); " +
    "node scripts/audit/verify-pt10-002.mjs.",
  scopeTag: "CONFIRMED-BROKEN",
});

// -- Scenario 2: worker killed mid-job -- permanently stuck submission_queue row -------------
appendFindingRow({
  id: "WGR-125",
  layer: "Worker/Queue",
  severity: "P1",
  description:
    "PT-10-002 scenario 2: a real, standalone child process was let claim a real submission_queue " +
    "row via the exact two-step claim predicate worker/queue-processor.ts's dequeue() uses " +
    "(confirmed via the child's own CLAIM_WORKER_CLAIMED log line before the kill), then SIGKILLed " +
    "mid-way through the simulated in-flight-work window, before any terminal status write. A " +
    "direct service-role re-read after confirming the child had actually exited (not just been " +
    "signalled) found the row permanently at status='processing', started_at set, completed_at and " +
    "error_message both still null, with no field drift from the original insert (no partial/" +
    "corrupt write -- rowCountForTestOrg:1, matches expected, zero unexpected field drift) and " +
    "confirmed NOT reclaimable via the real dequeue() predicate (status='pending' only). Three " +
    "code-read findings back this up as a structural gap, not a one-off: (1) dequeue() (lines " +
    "~420-459) has no stale-claim timeout -- a row already at status='processing' is invisible to " +
    "every future dequeue() call, forever, regardless of how long ago it was claimed; (2) no cron/" +
    "scheduled sweep anywhere in worker/scheduler.ts reaps stale submission_queue rows (repo-wide " +
    "grep for stuck/stale/reclaim/orphan job-sweep logic touching this table found none); (3) the " +
    "one existing manual admin remedy, POST /api/admin/system {action:'clear_stuck_jobs'} " +
    "(src/app/api/admin/system/route.ts lines ~157-189), only clears agent_runs rows stuck at " +
    "status='running' for over 2 hours and contains zero references to submission_queue -- an " +
    "admin clicking 'Clear Stuck Jobs' on /admin/system cannot reach this row even if they try. A " +
    "separate, older AutoApply system (automation_queue / AutomationWorkerAgent) DOES implement a " +
    "real reapTimedOutItems(), but only on a different table and only when a human/cron hits " +
    "POST /api/automation/process -- it provides no protection for submission_queue. Real impact: " +
    "any worker crash, OOM, host eviction, or deploy restart that lands mid-claim leaves a genuine, " +
    "permanent corrupt half-done state requiring direct DB intervention to recover -- the funder " +
    "application the row represents silently never gets submitted, retried, or flagged as failed to " +
    "anyone.",
  evidencePath:
    "test-evidence/pt-10/outage-simulation.json#scenarios.scenario2_worker_killed_mid_job " +
    "(behavior, postFailureIntegrityCheck, codeReadNotes, findings[0]=PT10-002-S2-001)",
  reproduction:
    "node --import tsx scripts/audit/pt10-002-outage-simulation.mjs (scenario 2 reproduces this " +
    "deterministically: seed a pending submission_queue row, let a worker claim it, SIGKILL the " +
    "worker before it writes a terminal status, re-read the row); node scripts/audit/verify-pt10-002.mjs.",
  scopeTag: "CONFIRMED-BROKEN",
});

// -- Scenario 3: grantsgov-client -- uncaught exception on malformed response ----------------
appendFindingRow({
  id: "WGR-126",
  layer: "Integration/Parser",
  severity: "P2",
  description:
    "PT-10-002 scenario 3 (malformed third-party response fuzz, monkeypatched global.fetch, never " +
    "the real internet): grantsgov-client.searchGrantsGovOpportunities throws an uncaught exception " +
    "on a genuinely malformed Grants.gov API response, with no try/catch protecting the immediate " +
    "real call site (src/lib/sources/grantsgov-sync.ts syncGrantsGovForOrg(), line ~101, " +
    "'for (const keyword of keywords) { const hits = await searchGrantsGovOpportunities(keyword); " +
    "... }'). Root cause: mapHit() (grantsgov-client.ts, an unexported helper) does hit.id/" +
    "hit.oppTitle on every array element with no null guard on the element itself; the outer " +
    "function only wraps the fetch() call and response.json() in try/catch -- the per-hit mapping " +
    "loop (lines ~126-129) sits outside both. One real protecting layer exists one hop further up: " +
    "src/app/api/cron/grantsgov/route.ts wraps EACH org's syncGrantsGovForOrg() call in its own " +
    "try/catch (line ~50), so a malformed response fails only that one org's entire sync for that " +
    "run (silently losing every keyword after the failure point, not just the malformed one) -- it " +
    "does not crash the cron job or any other org's sync.",
  evidencePath:
    "test-evidence/pt-10/outage-simulation.json#scenarios.scenario3_malformed_third_party_responses" +
    ".behavior[] (target==\"grantsgov-client.searchGrantsGovOpportunities\", id=\"PT10-002-S3-001\"), " +
    ".findings[0]",
  reproduction:
    "node --import tsx scripts/audit/pt10-002-outage-simulation.mjs (scenario 3, case PT10-002-S3-001).",
  scopeTag: "CONFIRMED-BROKEN",
});

// -- Scenario 3: samgov-client -- uncaught exception, zero protection at any layer -----------
appendFindingRow({
  id: "WGR-127",
  layer: "Integration/Parser",
  severity: "P2",
  description:
    "PT-10-002 scenario 3 (malformed third-party response fuzz): samgov-client." +
    "searchSamGovOpportunities throws an uncaught exception on a genuinely malformed SAM.gov API " +
    "response, with no try/catch protecting the immediate real call site (src/app/api/sources/" +
    "samgov/route.ts GET() handler, line ~53, 'const hits = await searchSamGovOpportunities();') -- " +
    "the entire GET() function body was checked directly and has NO try/catch anywhere, only " +
    "explicit early-return checks for specific known conditions (missing auth, missing orgId, a " +
    "failed opportunities SELECT). Same structural bug as WGR-126's grantsgov-client -- identical " +
    "file shape, same missing null guard on array elements in the response-mapping step. Unlike " +
    "WGR-126, no protecting layer exists anywhere further up: this route is hit directly by an " +
    "external cron trigger per the file's own header comment ('SYSTEM job... gated solely by " +
    "CRON_SECRET'), with no per-org looping wrapper in this codebase the way grants.gov's cron " +
    "route has. Blast radius is narrower (one HTTP request, not a multi-org loop) but the failure " +
    "mode is worse in kind: an uncaught exception here propagates out of the route handler " +
    "entirely, so the real caller (Vercel Cron) gets Next.js's own generic framework error response " +
    "instead of this route's own clean jsonError() JSON shape that every other failure path in this " +
    "file uses.",
  evidencePath:
    "test-evidence/pt-10/outage-simulation.json#scenarios.scenario3_malformed_third_party_responses" +
    ".behavior[] (target==\"samgov-client.searchSamGovOpportunities\", id=\"PT10-002-S3-002\"), " +
    ".findings[1]",
  reproduction:
    "node --import tsx scripts/audit/pt10-002-outage-simulation.mjs (scenario 3, case PT10-002-S3-002).",
  scopeTag: "CONFIRMED-BROKEN",
});

// -- Scenario 3: 7 of 9 cases handled malformed input safely. CONFIRMED-OK -------------------
appendFindingRow({
  id: "WGR-128",
  layer: "Integration/Parser",
  severity: "P3",
  description:
    "PT-10-002 scenario 3: 7 of 9 real parser/integration fuzz cases handled genuinely malformed " +
    "input without an uncaught exception, recorded together per the register's own established " +
    "convention of logging a clean/mitigated result set as its own row (see WGR-071/073/076/114/120) " +
    "rather than leaving it undocumented. propublica-990-client.fetchProPublicaFinancials (2 cases) " +
    "returned cleanly via its own internal try/catch (hasTryCatchAtImmediateCallSite:true -- " +
    "protection lives inside the function itself, not at the caller). irs990.ts IRS990Source." +
    "parseXml (4 cases: empty string, truncated mid-tag, binary garbage, a non-XML HTML error page) " +
    "is a pure synchronous function with no I/O and returned without throwing on all 4 -- correctly " +
    "degrades to partial/null fields rather than crashing the batch that calls it. ca-grants-portal-" +
    "client.fetchCaGrantsPortalFeed (1 case) also returned without throwing, though its own real " +
    "immediate caller (src/lib/sources/state-portals/ca-grants-portal-sync.ts line ~149) has no " +
    "try/catch either -- the only real protection found is one further hop up, in scripts/ingest-ca-" +
    "grants-portal.ts's main(), which wraps the equivalent call in try/catch and a clean fatal()/ " +
    "process.exit(1) helper. Not a full pass for that one library function -- it remains genuinely " +
    "unprotected for any other/future caller -- but this specific case did not throw against this " +
    "specific malformed payload.",
  evidencePath:
    "test-evidence/pt-10/outage-simulation.json#scenarios.scenario3_malformed_third_party_responses" +
    ".behavior[] (outcome==\"returned_without_throwing\", 7 of 9 cases)",
  reproduction:
    "node --import tsx scripts/audit/pt10-002-outage-simulation.mjs (scenario 3, cases " +
    "PT10-002-S3-003 through PT10-002-S3-006); node scripts/audit/verify-pt10-002.mjs.",
  scopeTag: "CONFIRMED-OK",
});

console.log("Registered WGR-123 through WGR-128.");
