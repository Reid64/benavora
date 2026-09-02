# BENAVORA SESSION HANDOFF — August 7, 2026
## For: Next Claude Chat Session
## Priority Order: READ THIS FIRST BEFORE DOING ANYTHING

---

## IMMEDIATE FIRST ACTION
Check whether the FORGE chain (queues 26-39) is still running before doing anything else:
```powershell
Get-Process -Id 15784 -ErrorAction SilentlyContinue | Select-Object Id, StartTime, CPU
Get-Content "C:\Users\manag\Documents\FORGE\reports\chain_benavora_2026-08-07_01-49-35.log" -Tail 30
```
If the PID is gone, check the log's last lines for "Chain Runner Complete" (finished) vs. an abrupt stop (needs relaunch).
If CPU delta over 20-30 seconds is nonzero, it's genuinely still working — do not assume it's stuck from appearance alone; this project has repeatedly had long silent stretches on real, healthy long-running prompts (one queue took 4h31m).

---

## PROJECT CONTEXT
Benavora (benavora.com) — AI-powered nonprofit grant funding automation SaaS, Next.js 14 + Supabase + Vercel + Railway worker.
Solo founder: Reid Whitesides. Non-technical product owner — Claude is senior technical advisor/builder.
Repo: C:\Users\manag\Documents\benavora (GitHub: Reid64/benavora)
FORGE: C:\Users\manag\Documents\FORGE\forge.ps1, chain-forge.ps1
Production: www.benavora.com — deploy is now GATED (see DIRECTIVE-019 below), not manual-only anymore.

---

## WHAT WAS ACCOMPLISHED THIS SESSION (multi-day, extensive)

### Security (major, multi-day effort)
- All 162 production database tables audited for anon-key exposure. 160 were found exposed (95 missing TRUNCATE revoke despite having other RLS policies; 65 had zero RLS at all, including `nonprofits` at 1.98M rows and `foundation_directory` at 133K rows).
- ALL 162 tables now secured — this was completed across multiple passes (top 10 by row count fixed manually with real call-site tracing, then all 55 remaining Category C tables fixed via FORGE queue-23 with the same discipline).
- Root cause: this Supabase project's public schema auto-grants full anon/authenticated CRUD by default on every new table — remember this for any future `CREATE TABLE`.
- `request_profiles`/`org_documents` RLS gap (found live-leaking Faith Foundation's real funding-request data to anon) — found and fixed August 6.
- Storage bucket RLS: `org-{orgId}` buckets and the shared `documents` bucket both had zero `storage.objects` policies (bucket creation ≠ policy creation, a recurring gap) — fixed.

### Data enrichment — TEOS local import (complete)
- 12 local IRS 990 XML zip files (`C:\Users\manag\Documents\BENAVORA SaaS\irs-990-zips\`) fully processed via `scripts/import-teos-local.ts`.
- Final numbers: 705,147 filings parsed, 670,374 distinct EINs, **96,698 foundations enriched**, **559,027 nonprofits enriched**, 41,465 unmatched EINs logged to `enrichment-output/teos-local-unmatched-eins.csv` for future review.
- Fixed a real `[object Object]` logging bug (String() on non-Error objects) that was masking real Supabase errors during the run.
- Real lesson learned: this project's background-task "killed" notifications are unreliable — verify with fresh process checks (`Get-Process`) and CPU-delta sampling, never trust a self-reported status alone.

### AutoApply pipeline (major milestone — first-ever clean E2E pass)
- Root-caused and fixed, in sequence: dead `funders.automation_level` schema gap, `checkOrgReadiness()` querying a nonexistent column (was failing readiness for EVERY org, not just test), missing `storage.objects` RLS on document buckets, Railway worker's Docker image missing `ffmpeg` (crashed every Playwright session), `form-analyzer-agent.ts` sending Claude empty-content messages, missing `form_templates.automation_assessment` column, and a dead local `ANTHROPIC_API_KEY`.
- **6/6 real live tests now pass**, including the "ready-org" E2E test for the first time in this project's history.
- Built and verified this session: Gmail Confirmation Monitor spec, CAPTCHA/verification detect-and-pause logic (explicitly NEVER solves or bypasses — pauses to `needs_review`, confirmed live against Google's real reCAPTCHA demo), Review Queue UI with a concurrency guard (verified 3x that only one reviewer can act on a paused session).
- A mutual-exclusion guard was added between the two separate AutoApply implementations (Agent 16 manual-trigger path vs. `submission_queue`→worker path) to prevent a latent race condition — not currently exploitable (Agent 16 is gated behind an unreachable feature flag) but was a real structural risk.

### Agent roster — final tally
Of 32 canonical agent numbers (AG-01–30, AG-41, AG-42):
- **26 BUILT AND VERIFIED WORKING**
- 2 BUILT BUT NOT WIRED (AG-03, AG-19 — code works standalone, nothing in production instantiates the class)
- 3 BUILT BUT BLOCKED (AG-14, AG-15's autonomous wrapper, AG-24 — each has a specific, named blocker)
- 1 genuinely NOT BUILT (AG-23 — and even this is a naming artifact; its real implementation lives under `AG-32`/`relationship-graph-builder-agent.ts`)
- Of 7 agents that were phantom specs as of ~July 30, 6 were built and live-verified this week (AG-10, AG-26, AG-27, AG-29, AG-41, AG-42).
- Full detail: `AGENT_VERIFICATION_LOG.md`, `NOT_BUILT_MASTER_INVENTORY.md`.

### Bug fixes this session (each independently re-verified live, not trusted from commit messages)
- AG-17: `perceiveState()` querying `org_id` instead of `organization_id` — fixed, 169 real rows confirmed.
- AG-15: `buildKeyRisks()` bounds-check ordering bug (lapsed deadlines showed wrong risk text) — fixed, 10/10 regression tests pass.
- AG-39/ROI Optimizer: confirmed already had real production wiring (a stale finding from an earlier session had claimed otherwise).
- `relationship_memory` table: confirmed genuinely missing despite its migration file existing — flagged, not yet fixed.
- 8 `FEATURE_REGISTRY_v2.md` rows found stale post-reconciliation (built features whose registry row was never updated) — flagged, not all fixed yet: #92, #98, #99, #100, #116, #120, #157, #160.

### Deploy failure investigation — ROOT CAUSED AND STRUCTURALLY FIXED
This was the most important finding of the final session stretch. The recurring Vercel deploy failures were NOT random or evidence of a broken foundation — they had one exact, findable, fixable cause:
1. A real ESLint `no-unused-vars` error in `agents/marketplace/[agentId]/page.tsx` (an unused `errorBoxStyle` — turned out to be a real, designed error state that was never wired into the actual render; fixed properly, not just silenced).
2. **`deploy-check.yml` (the CI gate that would have caught this) was detached from running on every push back on July 17**, for an unrelated reason (a volume/redundant-runs concern) — leaving zero automated gate between a bad commit and production for weeks.
3. Root-caused why THAT gate itself had never actually passed once in its history: an OOM crash (fixed by raising `NODE_OPTIONS=--max-old-space-size=4096`), which was masking a second failure underneath — missing `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` as GitHub repo secrets (added — these are safe public/anon values, not service-role secrets).
4. `deploy-check.yml` re-enabled on every push, with a `concurrency`/`cancel-in-progress` group added so a burst of commits doesn't queue dozens of redundant runs (the original reason it got disabled).
5. **NEW, permanent, structural fix**: a real git **pre-push hook** (`.githooks/pre-push`, auto-installed via `pnpm install`'s `prepare` script) that runs the actual `pnpm run build` and **blocks the push entirely** if it fails — tested for real with a throwaway broken commit, confirmed it genuinely blocks (`pre-push: BLOCKED, exit code 1`).
6. This is DIRECTIVE-019 in `STANDING_DIRECTIVES.md`, and mandatory step 4 in `FORGE_CANONICAL_INSTRUCTIONS.md` Rule 2 / §12 checklist — every future FORGE/CC session's commits now get caught locally before they can even reach GitHub.

**Bottom line for next session**: if a new deploy failure appears, it means either (a) a genuinely new bug got past the new pre-push gate somehow (worth investigating how), or (b) the gate itself has a gap — do not assume "here we go again," this class of problem should now be structurally much rarer.

### API key consolidation
Reid was juggling 3 separate, drifted Anthropic API keys ("benavora," "new key," "ANTHROPIC") across this and other projects, causing repeated dead-key failures. All three deleted, replaced with **one single canonical key**, synced across `.env.local`, Railway, and Vercel (with a forced redeploy, since env var changes don't apply to already-running serverless functions — a real, previously-learned lesson). **Reid does not want key rotation requested casually going forward — he uses one key across multiple unrelated apps and each rotation disrupts them all.** If a key issue arises, diagnose precisely (dead vs. load-order bug vs. wrong-key-referenced) before ever asking him to touch the Anthropic console again.

### Google Places / Maps
Was using a stale key from an unrelated, pre-provisioning GCP project (778643669392) documented weeks before the real "benavora" GCP project (69925994408) existed. Found via git-blame archaeology, corrected everywhere, Places API (New) + Geocoding enabled on the real project, all three acquisition paths (legacy Places, Places New, Geocoding) confirmed working with real data.

### SAM.gov
Fixed an invalid `limit` parameter that was silently zeroing every acquisition result (real API returned 400, swallowed by error handling) — this is why corporate/government acquisition had been finding nothing.

### DDL access — solved permanently
Prior sessions were blocked on every schema change, needing hand-pasted SQL Editor commands one statement at a time (real risk: implicit-transaction batching silently dropped some statements, as happened to migrations 093/088's `ALTER TYPE` lines). **A working direct Postgres connection now exists** — `DATABASE_URL` in `.env.local`, real password, confirmed live via `psql "$DATABASE_URL" -f file.sql`. This is DIRECTIVE-017. Use `psql` directly for any future migration/DDL — do not default to generating SQL-Editor handoff files unless this path is confirmed broken.

---

## KNOWN OPEN ITEMS (not yet resolved, in priority order)

1. **FORGE chain queues 26-39** — check status per the "immediate first action" above. May have completed, may still be running, may have died and need a relaunch (same detached-`Start-Process` pattern as before if so).
2. **8 stale `FEATURE_REGISTRY_v2.md` rows** post-reconciliation (#92, #98, #99, #100, #116, #120, #157, #160) — flagged, not fixed.
3. **`relationship_memory` table missing** despite its migration file existing — flagged, not fixed.
4. **AG-19 (RelationshipBuilderAgent)** — real, substantial code (Phase A + B, including multi-hop warm-intro pathfinding), never instantiated anywhere; `worker/autonomous-orchestrator.ts` substitutes the unrelated `FunderRelationshipAgent` instead. Real wiring decision needed, not a mechanical fix.
5. **AG-24** — route exists (`src/app/api/intelligence/outreach/generate/route.ts`), underlying blockers appear resolved but not independently re-tested live.
6. **Sales Outreach / Outreach / Email consolidation** — three overlapping systems, flagged near the start of this whole multi-day session, never touched since.
7. **6 unrelated `.claude/worktrees/agent-*` pointer diffs** sitting permanently unstaged in the working tree — belong to other concurrent sessions, deliberately left alone every time; do not touch without understanding what's actively using them.
8. **T4-T8 test suite** (E2E, visual regression, DB migration tests, soak tests, cross-browser) — genuinely never built, real gap in `FEATURE_REGISTRY_v2.md`.
9. **US6/US7 universal scraper templates** (foundation-990, nonprofit-contact) — code complete, type-checks clean, zero real-data verification, uncommitted. May be redundant with what TEOS local-import already accomplished — worth a scoping conversation before running, not just launching blind.

---

## STANDING DIRECTIVES (STANDING_DIRECTIVES.md — read this file in full)
- DIRECTIVE-017: Direct Postgres DDL access via `DATABASE_URL`/`psql` — use this, not SQL-Editor handoffs.
- DIRECTIVE-018: Single canonical Anthropic API key — do not request rotation casually.
- DIRECTIVE-019: Pre-push build gate — mandatory, already installed, do not bypass or remove.

## COMMUNICATION / WORKFLOW PREFERENCES (critical, apply to every session)
- **"Chain it"** = write Claude Code prompts as one multi-step instruction ending in a literal executable command, not separate prompts requiring re-pasting. Default posture for any multi-stage task.
- Every FORGE/CC prompt must end with a `STATE_OF_THE_BUILD.md`/`SESSION_STATE.md` update instruction — permanent standing requirement.
- Never claim something is "fixed" or "verified" without live evidence (real query results, real test output) — this entire session's reliability came from refusing to trust self-reported success, and multiple real bugs were only found by insisting on this.
- Scoped git commits only — never blind `git add -A` (this repo has persistent unrelated worktree/submodule noise that must not get swept into unrelated commits).
- One command at a time unless explicitly chained.
- Reid does not want casual API key rotation requests (see above).
- Claude will not build: CAPTCHA-solving/bypass, autonomous third-party account creation, or third-party email inbox interception for AutoApply — this was explicitly discussed and declined regardless of framing; the legitimate alternative (detect-and-pause-for-human) is what got built instead and is working.

---

## KEY FILE LOCATIONS
- Repo: `C:\Users\manag\Documents\benavora`
- FORGE: `C:\Users\manag\Documents\FORGE`
- TEOS source zips: `C:\Users\manag\Documents\BENAVORA SaaS\irs-990-zips\`
- Governance docs (all in repo root): `STATE_OF_THE_BUILD.md`, `SESSION_STATE.md`, `STANDING_DIRECTIVES.md`, `FEATURE_REGISTRY_v2.md`, `AGENT_VERIFICATION_LOG.md`, `NOT_BUILT_MASTER_INVENTORY.md`, `AGENTS_v2.md`, `SCHEMA_REGISTRY_v2.md`, `AUTOAPPLY_ARCHITECTURE_V2.md`, `FORGE_CANONICAL_INSTRUCTIONS.md`
- Latest audit docs: `ANON_GRANT_AUDIT.md`, `RLS_POLICY_AUDIT.md`, `STORAGE_POLICY_AUDIT.md`, `SCHEMA_DRIFT_AUDIT.md`, `MIGRATION_AUDIT.md`, `MASTER_BACKLOG.md`, `DEPLOY_FAILURE_STRUCTURAL_AUDIT.md`

---

## NEXT SESSION PRIORITY ORDER
1. Confirm FORGE chain status (complete / still running / needs relaunch)
2. Fix the 8 stale registry rows and `relationship_memory` table
3. Decide AG-19's wiring (real design decision — replace `FunderRelationshipAgent` or keep both intentionally)
4. Sales Outreach/Outreach/Email consolidation (real architecture decision, deserves a clear-headed session, not a rushed FORGE prompt)
5. T4-T8 real test suite
6. Continue working down `FEATURE_REGISTRY_v2.md`'s remaining genuine PLANNED items per the reconciled, corrected registry
