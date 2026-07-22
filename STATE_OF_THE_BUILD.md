# STATE_OF_THE_BUILD.md
## BENAVORA — Current Build Status
**Updated: July 22, 2026, from git log + live verification (checkpoint files, running processes, DNS/HTTPS check, code grep). Not FORGE-auto-generated this session — hand-verified.**

> Note: prior to this update, this file's header/body was stale boilerplate carried over from an unrelated earlier project template (RFQ/drawing-tool "AFS" content) and had not tracked Benavora's real state for some time. It has been fully replaced below. Current session narrative and priorities live in `SESSION_STATE.md`; the July 21 handoff is `BENAVORA_HANDOFF_JULY21.md`.

---

## OVERALL STATUS

```
Platform:               BENAVORA — AI-powered nonprofit funding automation SaaS
Production:             benavora.com — LIVE on Vercel (DNS resolves to 76.76.21.21,
                         HTTPS confirmed, 308 redirect to www.benavora.com working)
Database tables:        60+ confirmed live in Supabase (ref vbjplpquqxxfbpazyalt).
                         NOT reachable via this session's connected Supabase MCP account
                         (that account only shows unrelated projects "tarritrix" /
                         "tarritrix-audit") — table count is carried from the manual
                         July 20 2026 verification recorded in BENAVORA_HANDOFF_JULY21.md
                         (13 tables applied manually via SQL editor that day), not
                         re-verified fresh this session.
Autonomous agents:      30 built (18 original + 12 Phase 2-5). See caveat below —
                         "built" does not mean all 30 are wired into a live call path.
FORGE queue library:    32 queues in library-manifest.yaml — 31 status: complete,
                         1 status: running (queue-vercel-dns-setup — DNS is in fact
                         already live per the check above; this manifest entry looks stale).
```

---

## AUTOAPPLY

- **StealthBrowser + FormFiller: confirmed working.** Per July 20-21 session, live submission to Meade Tractor completed in 43s.
- **CaptchaSolver: now wired (commit `3e7400b`).** Verified by direct grep of `src/lib/autoapply/form-filler-agent.ts` — `captcha-solver.ts` is imported and its `detect` / `solveCaptcha` / `injectSolution` calls are present in the actual submission flow (not just an unused file). Handles recaptcha v2/v3, hcaptcha, turnstile; audit logging; screenshot capture; degrades gracefully when no 2Captcha key is configured. This closes Feature #63 (previously PARTIAL — "not wired").

## FOLLOW-UP WORKER

- **process-followups: fully implemented.** `src/worker/jobs/process-followups.ts` — verified 276 lines (commit `2f822b1` message said "150+ lines"; actual line count is 276). This closes Feature #74 (previously PARTIAL — "stub only").

## DATA PIPELINES — VERIFIED STATE (July 22, 2026)

Ran `pnpm tsx scripts/check-enrichment-detailed.ts` and checked live checkpoint files / running processes directly. Results:

| Pipeline | Claimed | Verified | Status |
|---|---|---|---|
| IRS BMF import | 1.97M records | **1,978,526 total nonprofit records** confirmed live | ✅ Accurate |
| ProPublica financial enrichment | 66% complete, 1.3M records | **66.1%, 1,307,022 records** (`last_enriched_at` set) | ✅ Accurate |
| ProPublica contact+address enrichment (commit `7e89db1`) | Built and running | **Confirmed actively running** — 3 parallel state-partitioned `pnpm enrich:propublica-contacts` processes live in the process table right now, covering West/AK/HI, South-Central, and Southeast/Northeast state groups | ✅ Accurate, but very early: `officer_name` populated on only 6,781 records (0.3%), `website` on 0 (0.0%) so far |
| 990 XML ZIP enrichment | 4/12 ZIPs done | **Confirmed via `%TEMP%\irs-990\progress.json`: exactly 4 of 12 ZIPs completed** (01A–04A) | ✅ Accurate |
| USASpending/NIH/NSF federal import (`pnpm import:federal`) | "Import running" | **Not running.** No `import-federal-awards` process found in the live process table. `scripts/.checkpoints/federal-awards-checkpoint.json` shows `done: false` for all three sources with **0 records inserted** in any of them (usaspending nextPage: 5, nih nextOffset: 0, nsf stateIndex: 0), last updated 2026-07-21T09:13 — over a day stale. | ❌ **Correction: this pipeline is stalled/non-functional, not active.** Needs investigation before it can be claimed as running. |

## INTELLIGENCE LIBRARY & DONOR DISCOVERY

- Both `queue-intelligence-library-enterprise` and `queue-donor-discovery-enterprise` show `status: complete` in the FORGE library manifest — enterprise rebuilds (schema, full-text search, filters, pattern extraction engine for Intelligence Library; Google Places pipeline, CSR programs, portal types, intent signals for Donor Discovery) are done per that record.
- The Intelligence Library's federal-source record counts should NOT be assumed current given the federal import pipeline is stalled (see table above) — the "700+ records from USASpending/NIH/NSF/ProPublica" in the manifest description reflects the queue's build-time target, not confirmed current live counts from those three sources specifically.

## AUTONOMOUS AGENTS — 30 BUILT, WITH KNOWN WIRING GAPS

FEATURE_REGISTRY_v2.md documents 30 designed/built agents (AG-01 through AG-40, phases 1-5). Two are flagged in that document's own notes as **not actually wired into any live call path** (confirmed by repo-wide grep, dated July 19 2026 in that file):
- **AG-36 (Global Learning Network aggregator)** — real 905-line implementation, never imported or called anywhere in `src/` or `worker/`.
- **AG-39 (ROI Optimizer)** — only the telemetry half (`trackSubmissionVariables`) has a live call site; its `run()` method (the Claude-calling correlation pass that populates `roi_insights`) has none, so `/reports/roi` reads a table nothing populates.

Treat "30 agents built and wired" as accurate for "built"; for "wired to a live trigger," the true count is 28 of 30 per the existing registry notes above.

---

## FORGE ORCHESTRATOR

- 32 queue files registered in `C:\Users\manag\Documents\FORGE\library\benavora\library-manifest.yaml` (verified count).
- `forge.ps1` encoding fix and workDir bug fix carried forward from prior session notes (`BENAVORA_HANDOFF_JULY21.md`) — not independently re-tested this session.

---

## DOMAIN

- **benavora.com is live on Vercel.** Verified this session: `nslookup benavora.com` resolves to `76.76.21.21` (Vercel's anycast IP, matching the A-record instructions in the July 21 handoff doc), and `curl -I https://benavora.com` returns `HTTP/1.1 308` redirecting to `https://www.benavora.com/` with `Server: Vercel`. DNS setup that was listed as an open action item in the July 21 handoff doc has since been completed.

---

## KNOWN ISSUES CARRIED FORWARD (unchanged this session, see prior memory/handoff docs)

- Federal import pipeline (USASpending/NIH/NSF) stalled at 0 records — needs debugging, not just re-running.
- AG-36 and AG-39 dead-code gaps (not wired).
- Prior open items from `BENAVORA_HANDOFF_JULY21.md` (SchoolFunder removal, Faith Foundation org dedup, etc.) not re-verified this session — check that doc and `SESSION_STATE.md` directly.

---

*STATE_OF_THE_BUILD.md | Hand-verified July 22, 2026. Update by re-running the verification commands above, not by copying claims without checking them.*
