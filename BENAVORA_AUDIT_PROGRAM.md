# BENAVORA ENTERPRISE AUDIT PROGRAM
## Comprehensive Full-Stack Functional, Integration, and Production-Readiness Audit

**Version 1.0 — 2026-08-19**
**Project:** Benavora (Reid64/benavora) — AI-powered nonprofit grant management SaaS
**Purpose:** Establish the true, evidence-backed operational state of every layer of the
platform before any further feature build, and produce a single ranked remediation backlog
(`WIRING_GAP_REGISTER.md`) that supersedes all prior status documents.

---

## 0. WHY THIS PROGRAM EXISTS — THE STANDARD IT ENFORCES

Benavora's documented history contains a specific, recurring failure: governance documents,
commit messages, and prior audit passes have claimed features "complete," "fixed," or
"verified live" when the underlying behavior was later found broken, invisible in production,
never committed, or reading from a table nothing populates. Concrete instances on record:

- Pages recorded as design-fixed twice that live `getComputedStyle()` later proved untouched.
- A feature registry asserting BUILT for agents whose backing tables hold zero rows.
- A deploy-verification script printing "DEPLOYMENT VERIFIED" while simultaneously logging
  that it could not check production because required tokens were absent.
- Agent code with a real call site but zero rows ever written — "wired" but never executed.

The lesson is not that the platform is broken. The lesson is that **claims of working state
have not been trustworthy without independent, reproducible evidence.** This program's
defining characteristic is therefore not the breadth of what it tests — though it is broad —
but the evidentiary standard every check must meet before a result is recorded.

**The Evidence Standard (non-negotiable, applies to every check in every phase):**

A check may record PASS only when a machine-readable artifact exists that a skeptical third
party could re-run or re-inspect to reach the same conclusion. Acceptable artifacts:

1. Captured stdout/stderr of a command, saved to a file, showing the actual result.
2. A real database query — the SQL itself recorded — with its actual returned rows/counts.
3. A Playwright screenshot **plus** the programmatic assertion that passed against the live
   DOM (a screenshot alone is not evidence; the assertion is).
4. An HTTP response capture (status, headers, body) for API-level checks.

A prose statement ("this works," "verified," "looks correct") is **not** evidence and causes
the check's FORGE gate to fail. Every prompt in every phase ends by executing an assertion
script (`scripts/audit/verify-<phase>-<n>.mjs`) that exits non-zero unless the required
artifact exists on disk with real captured content. FORGE's gate machinery enforces this —
the audit cannot advance on an unsubstantiated claim.

---

## 1. ARCHITECTURE OF THE PROGRAM

### 1.1 Execution model

The program runs as a FORGE library: a sequence of gated queue files, each surviving
interruption, each retrying on gate failure, each writing findings to a shared register.
This is the correct tool over a single chained CC prompt because the audit must (a) enforce
verification at every step, (b) survive multi-day execution, and (c) accumulate evidence that
persists across restarts. FORGE 2.0 is invoked for the entire program.

### 1.2 The single output artifact

Every phase appends to **`WIRING_GAP_REGISTER.md`** — one finding per row, each carrying:

| Field | Meaning |
|---|---|
| ID | `WGR-###`, stable, referenced by rebuild queues |
| Layer | Which phase/surface found it |
| Severity | P0 / P1 / P2 / P3 (defined below) |
| Finding | What is actually true, in one sentence |
| Evidence path | The artifact file proving it |
| Reproduction | The exact command or steps to see it again |
| Scope tag | `CONFIRMED-BROKEN` / `UNVERIFIED` / `PENDING-SCOPE` / `CONFIRMED-OK` |

### 1.3 Severity definitions

- **P0 — Broken in production.** A user or tenant hits this today. Data-isolation failures,
  crashes, silent data loss, security exposure on live data. Fix before anything else.
- **P1 — Broken but currently unreachable.** Real defect, no live trigger yet (dead code
  path, unwired agent, unregistered cron). Becomes P0 the moment it's wired.
- **P2 — Wired but unverified.** Executes, but correct output never independently confirmed.
  The largest and most dangerous-to-assume category.
- **P3 — Cosmetic / documentation drift.** Real but non-functional: stale docs, naming
  collisions, doc-vs-code mismatches that mislead future work.

### 1.4 Environment split (safety)

- **Production (read-only / unauthenticated checks):** route reachability, unauth rejection,
  third-party read calls, client-bundle secret scans, public-surface enumeration. Prod-truth
  is the point; these cannot corrupt anything.
- **Local dev + dedicated Supabase branch (all destructive checks):** cross-tenant write
  attempts, outage simulation, load/concurrency, malformed-input fuzzing, migration
  idempotency re-runs. Faith Foundation's live demo tenant is never a test subject for
  write/load paths.
- **Both, cross-checked:** anything where a prod-vs-local discrepancy is itself a finding
  (schema drift, env parity, deploy drift).

---

## 2. THE AUDIT PHASES

Nineteen functional surfaces, consolidated into fifteen gated queues where surfaces share the
same per-route or per-table execution pass. Each phase lists its scope, method, and the
evidence each check must produce.

### PHASE 00 — BASELINE, INSTRUMENTATION & SMOKE
**Establishes the ground truth everything else measures against.**
- Build the route manifest from a *fresh* production build (not from `nav-items.ts` claims,
  not from the blueprint) — the actual set of routes the app ships.
- Environment-variable audit: enumerate every `process.env.*` reference in the codebase,
  cross-check against `.env.local`, Vercel, and Railway. Missing/misconfigured vars recorded
  (this is what let the deploy-verifier silently no-op).
- Create the Supabase test branch; provision two clean test tenants (Org A, Org B) for
  isolation testing; confirm demo-tenant write protection is intact.
- Stand up the evidence framework: `test-evidence/` tree, `WIRING_GAP_REGISTER.md` scaffold,
  the `scripts/audit/verify-*.mjs` gate harness, and add a `command` gate type to the
  orchestrator if not already present.
- Smoke suite: every route in the fresh manifest returns non-error to an authenticated
  session; capture HTTP status per route.
- **Also resolves the build-timeout risk:** confirm `cpus: 1` (or equivalent) is present in
  `next.config.mjs`; if absent, that is WGR-001 and is fixed here, because every later build
  gate depends on it.
- **Evidence:** route manifest JSON, env-audit table, branch connection proof, per-route
  smoke status capture.

### PHASE 01 — APPLICATION WIRING AUDIT
**Every route renders; every link and button resolves to something real.**
- Each route in the manifest loads without runtime error against a real authenticated session.
- Every visible navigation element (sidebar, header, settings nav, admin nav, in-page
  links/buttons) resolves to a real destination — no dead anchors, no 404s, no
  buttons wired to nothing.
- Every "queued"/"processing"/"pending" state links to where its result actually lands.
- Re-verify from scratch any fix claimed in history but lacking a matching commit.
- **Evidence:** per-route render capture; a link-graph JSON (source element → destination →
  resolved status); screenshots of any dead-end with the failing assertion.

### PHASE 02 — API, CRUD & AUTHORIZATION
**One rigorous pass per API route.**
- Unauthenticated request to every route → correct rejection (prod, read-safe).
- Role enforcement per `requireRole` tier: viewer/member/admin/owner each tested against
  routes above their level → correct refusal.
- Full CRUD cycle through the API layer (not direct DB) on the branch: create, read, update,
  delete, with response codes and body shape asserted at each step.
- Viewer-role write attempts → rejected.
- **Evidence:** per-route HTTP capture matrix (method × role × expected-vs-actual status).

### PHASE 03 — END-TO-END WORKFLOWS
**Real user journeys, start to finish, on local + branch.**
- Signup → onboarding → discovery → draft → pipeline → deadline.
- AutoApply: queue → session → form-fill → safe-simulated submit → UI status reflects result.
- Donor Discovery: prospect → review → route-to-destination (confirm the destination exists
  and receives).
- Kanban 12-stage transitions with the documented stage-transition rules enforced.
- Auth flows: password reset, magic link, session persistence across reload.
- **Evidence:** per-journey step log with DB state captured before/after each transition;
  screenshots at each stage gate.

### PHASE 04 — FUNCTIONAL & BUSINESS LOGIC
**Hand-checkable correctness against known inputs.**
- `computeGrantProbability` — factor weights and final score hand-verified against a known
  opportunity+org pair; the stored row matches the recomputation field-by-field.
- Deadline/reminder timing math.
- Budget reconciliation (`grant_budgets` / `expenses` / `reconciliation_reports`) arithmetic.
- Draft confidence scoring; AutoApply eligibility logic; match/fit scoring.
- **Evidence:** for each, the input, the hand-computed expected value, the system's actual
  value, and the pass/fail delta — captured, not asserted in prose.

### PHASE 05 — MULTI-TENANT ISOLATION *(branch only)*
**The P0-critical surface: no tenant can ever see or touch another's data.**
- Authenticated as Org A, attempt read AND write against Org B data on **every** live table
  via modified IDs — RLS block confirmed per table with the actual Postgres error code
  captured.
- Demo-account write-protection re-verified against the live protection migration.
- Admin impersonation scoping + audit-logging confirmed (impersonation is bounded and logged).
- **Evidence:** per-table isolation matrix (table × read-attempt × write-attempt ×
  actual-result); the raw error codes.

### PHASE 06 — DATABASE INTEGRITY
**The schema is what the code thinks it is.**
- Applied-vs-on-disk migration audit: settle exactly which migrations are live, resolving
  the two-parallel-migration-directories collision and the "N of M unapplied" question with a
  real query against the live migration table.
- Constraint / foreign-key / orphaned-row audit.
- Duplicate and null-rate audit on the large tables (foundation directory, nonprofit records).
- Migration idempotency: re-run each on the branch, confirm no error and no data change.
- **Evidence:** applied-migration list from the DB; constraint report; dup/null counts with
  the queries; idempotency re-run logs.

### PHASE 07 — THIRD-PARTY INTEGRATIONS
**Real calls, real evidence — never an assumed 200.**
- Supabase (DB, Auth, Storage, and the Realtime publication's actual member-table list),
  Railway worker (heartbeat + real job pickup + completion write-back observed),
  Resend (a real delivery, not an API acknowledgment),
  Stripe (checkout + webhook, if billing is kept — else recorded PENDING-SCOPE),
  Google Calendar (OAuth + sync), Grants.gov, SAM.gov, USASpending, ProPublica, IRS endpoints,
  ScraperAPI rotation.
- **Evidence:** per-integration request+response capture; for the worker, the before/after
  job-row state; for Resend, the actual delivery confirmation.

### PHASE 08 — BACKGROUND JOBS & QUEUES
**What actually boots and runs, versus what's documented.**
- `worker/index.ts` boot inventory: which processors actually start (catches the
  dead-code class — a real pipeline never started from boot).
- Every documented cron cross-referenced against `vercel.json` and `worker/scheduler.ts`
  reality; unregistered crons recorded.
- `agent_queue` claim / retry / max-retries / completion semantics exercised on the branch.
- **Evidence:** boot-log capture with the processor list; cron cross-reference table;
  queue-semantics test log.

### PHASE 09 — AGENT ORCHESTRATION
**AG-01 through AG-43, each proven individually.**
- For each agent: trigger fires → real rows written (before/after counts captured, not prose)
  → failures surfaced, not swallowed.
- Settles every "BUILT — UNVERIFIED" tier: explicitly re-tests the agents blocked on the
  now-rotated API key, the unwired learning aggregator, the zero-row ROI optimizer, and the
  number-collision pairs.
- **Evidence:** per-agent row-delta capture (table, before count, after count, sample row);
  the trigger invocation log; any error surfaced.

### PHASE 10 — ERROR HANDLING & RECOVERY *(branch only)*
**Graceful failure, no corruption.**
- Malformed payloads on every input surface.
- Supabase slow/unavailable simulation; Railway worker killed mid-job; malformed third-party
  responses.
- Assert: graceful degradation, no white screens, no partial-write corruption, clean recovery.
- **Evidence:** per-scenario behavior capture; post-failure DB integrity check.

### PHASE 11 — REGRESSION SUITE EXECUTION
**Run the built-but-never-run tests, for real.**
- Visual regression against a fresh baseline of the current verified UI.
- Cross-browser rerun targeting the known WebKit navigation race.
- Soak re-run accounting for the known rate-limiter finding.
- Migration tests; existing unit/smoke/API suites — with dated real pass/fail numbers.
- **Evidence:** each suite's real output with counts; the visual-diff artifacts.

### PHASE 12 — LOAD & CONCURRENCY *(branch only, runs last among tests)*
- Realistic concurrent-user simulation; sustained soak; memory-growth tracking on the worker
  and Next server; DB connection-pool behavior; rate-limit behavior under contention.
- **Evidence:** load-run metrics; memory-over-time capture; pool/limit behavior log.

### PHASE 13 — OBSERVABILITY & LOGGING
**Failures are visible when they happen.**
- Silent catch-block census: every `try/catch` and `.catch` that swallows without logging.
- `agent_runs` / `agent_decisions` completeness versus actual executions.
- Error-surfacing paths to the UI; what monitoring/alerting actually exists in prod.
- **Evidence:** the silent-catch inventory with file/line; run-log completeness comparison.

### PHASE 14 — SECURITY
**Adversarial, table-by-table, bundle-deep.**
- Injection sweep (SQLi/XSS/CSRF/SSRF) across every real form and API input.
- Secrets/keys scan of the shipped client bundles.
- Table-by-table RLS policy audit **settling the direct conflict** between the backlog's
  Tier-1 finding (multiple anon-readable tables, unpoliced storage buckets) and the later
  "all confirmed" claim — each of the disputed items re-checked individually with the anon
  key and the result captured.
- `storage.objects` policy audit per bucket; anon-key surface enumeration.
- **Evidence:** injection attempt/result matrix; bundle scan output; per-table anon-access
  capture; per-bucket policy capture.

### PHASE 15 — PRODUCTION READINESS REVIEW
**Go / no-go, and the consolidated backlog.**
- Env parity across local / Vercel / Railway.
- Backup + restore drill on the branch (proves the restore path actually works).
- Rate-limiting posture; the false-PASS deploy-verifier fixed so it fails loudly when it
  can't verify.
- **Consolidate every phase's findings into the final `WIRING_GAP_REGISTER.md`,** ranked
  P0→P3, each with evidence path and reproduction — the single source that replaces every
  prior status document and becomes the rebuild backlog.
- **Evidence:** env-parity table; restore-drill log; the completed register itself.

---

## 3. DEPENDENCY & SEQUENCING

```
PHASE 00 ──> everything (baseline is prerequisite)
PHASE 01, 02, 06 ── early (cheap, feed later phases)
PHASE 03 ── needs 01 + 02
PHASE 08 ──> PHASE 09 (agents need the job/queue truth first)
PHASE 05, 06 ──> PHASE 14 (security builds on isolation + schema truth)
PHASE 10 ── needs 02 + 08
PHASE 12 ── last among tests (needs 03 + 09)
PHASE 15 ── needs all
```

Non-destructive prod-read phases (01, 02-reads, 07, 14-unauth) can run against production in
parallel with branch-based destructive phases, subject to the single-FORGE-run constraint
(one orchestrator at a time — phases run sequentially within the run, but their environment
targets differ as specified).

---

## 4. WHAT MAKES THIS ENTERPRISE-GRADE

1. **Evidence over assertion.** No check passes on a prose claim. Every PASS is a re-runnable
   artifact. This directly answers the platform's documented history of false "complete" claims.
2. **Full-surface coverage.** Nineteen functional surfaces from route wiring to load behavior
   to adversarial security — no layer exempt.
3. **Independent backstop on the audit's own claims.** The gate scripts are themselves checked
   in and re-runnable; a future session can re-execute any phase's verification.
4. **Severity-ranked, reproducible output.** The register is not a narrative; it is a ranked,
   evidence-linked, reproducible backlog an engineer (or an investor's technical diligence)
   could act on directly.
5. **Conflict resolution built in.** Where the platform's own documents disagree (the RLS
   dispute, the migration-count dispute, the agent-wiring disputes), the audit re-checks the
   disputed item directly and records the true state, ending the contradiction.
6. **Safe by construction.** Destructive checks are branch-isolated; the live demo tenant is
   never a write/load subject; the audit is additive and reversible.

---

## 5. ESTIMATED SCALE

Roughly 150–180 individual gated checks across the fifteen queues, each producing its own
evidence artifact. At the platform's established FORGE velocity this is a multi-day run;
because it is gated and interruption-survivable, it does not require supervision beyond the
review points. Read-only prod phases and branch-destructive phases are sequenced to avoid any
risk to production data.

---

## 6. REVIEW POINTS FOR REID

The program halts for human review at three points:
1. **After PHASE 00** — confirm the baseline (route manifest, env findings, test tenants,
   the build-config fix) before the audit proper begins.
2. **After PHASE 09** — the midpoint: agent + wiring truth is now established; review the
   register's P0/P1 findings before the harder destructive phases.
3. **After PHASE 15** — the completed register; this is where "audit" ends and the
   remediation-build planning begins.

---

*Prepared 2026-08-19. This is the audit-program specification. On approval, it is implemented
as the PT-series FORGE library (queue-pt-00 through queue-pt-15), authored one queue file at a
time, each honoring the established FORGE conventions: flat prompt lists, ASCII-only, command
gates, scoped commits, governance-doc updates at every prompt's end, and the completion-ledger
hardening now in place.*
