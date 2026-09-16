# Issues Detailed Audit — Phase 5.5

**Date:** 2026-09-15. Every issue below was diagnosed by reading the full implementation and, where the issue concerned live state (a DB enum, a table, a column, a production env var), verified directly against the live database (`psql "$DATABASE_URL"`) and the live Vercel production environment (`vercel env ls production`) rather than trusted from code comments alone. Several issues below turned out to be **stale documentation of an already-fixed bug**, not live bugs — that distinction is called out explicitly in each case, because "the code has a comment saying X is broken" and "X is actually broken today" are different claims, and this codebase has a strong history of the two drifting apart.

Carried forward from the prior session's audit (`COMPLETE_AGENT_AUDIT_FINAL.md`) and Phase 5.4's fixes; this document covers only the issues that were still open going into Phase 5.5.

---

## 1. AG-36 Learning Network Aggregator — `agent_type` enum gap (RESOLVED — was already fixed, comment was stale)

- **File:** `src/lib/agents/learning-network-aggregator-agent.ts`
- **Symptom claimed by the file's own header:** `"ag-36-learning-network"` is not a value in the `agent_type` Postgres enum, so `startRun()`'s insert into `agent_runs` would throw before any aggregation happens.
- **Root cause classification:** claimed schema mismatch.
- **Diagnosis:** `psql` query against the live enum (`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'agent_type'`) shows `'ag-36-learning-network'` **already exists live** — added by an earlier, never-committed DDL pass (the same pattern the codebase's own `p5a-002` comment documents for 8 other values). The comment was simply never updated after that DDL pass.
- **Fix applied:** corrected the stale "Known, unresolved gap" comment block in the agent file to state the enum value is confirmed present. Added `"ag-36-learning-network"` to the `AgentType` TypeScript union (`src/types/agents.ts`) for documentation completeness — not required for compilation (this `AutonomousAgent` subclass's `agentId` is a plain `string`, not typed against `AgentType`), but keeps the union an accurate catalog.
- **Priority:** was a blocker if real; turned out to be a non-issue. No functional risk either way.

## 2. AG-39 ROI Optimizer — `platform_patterns_applied` missing column (RESOLVED — real fix, additive migration)

- **File:** `src/lib/agents/roi-optimizer-agent.ts`
- **Symptom:** `submission_variables` had no column for `platform_patterns_applied`; the value was read from `applications.platform_patterns_applied` but discarded (`void application.platform_patterns_applied`) rather than sent in the insert, because PostgREST throws on an insert referencing a column the table doesn't have.
- **Root cause classification:** genuine schema gap (missing column), not a code bug.
- **Diagnosis:** confirmed live via `information_schema.columns` — `submission_variables` genuinely had no such column; `applications.platform_patterns_applied` (an `integer`) does exist (migration 084).
- **Fix applied:** `supabase/migrations/180_submission_variables_platform_patterns_applied.sql` — additive, nullable `ALTER TABLE ... ADD COLUMN IF NOT EXISTS platform_patterns_applied integer`, applied directly to the live database. Updated `trackSubmissionVariables()` to send the field in the insert payload instead of discarding it. Corrected the header comment.
- **Priority:** blocker for this one field's data completeness (not for the agent's core correlation logic, which never depended on it). Fully resolved.

## 3. AG-42 Change Monitor — `corporate_prospects` "does not exist" (RESOLVED — was already fixed, comment was stale)

- **File:** `src/lib/agents/change-monitor-agent.ts`
- **Symptom claimed by the file's own header:** `corporate_prospects` does not exist in production (reconfirmed live 2026-08-03), so this agent's corporate-prospects half always degrades to "zero prospects in scope."
- **Root cause classification:** claimed missing table.
- **Diagnosis:** `psql` confirms `corporate_prospects` exists live with **49 real rows**, and its schema (`id, legal_name, website, enrichment`, among others) exactly matches what `loadProspectScope()`'s query selects. The table was created the same day (2026-08-03) the "does not exist" comment was written — the two events simply landed in the wrong order in the file's history and were never reconciled.
- **Fix applied:** corrected three separate stale comment blocks (file header, scope-correction note, `loadProspectScope()`'s own docstring) to state the table is live and populated. No code change needed — the query was already schema-correct; it just needed the live table to exist, which it now does. The try/catch-and-treat-as-empty defensive pattern was kept (harmless, protects against a future schema change).
- **Priority:** was a blocker if real (half the agent's scope silently inert); turned out to be a non-issue.

## 4. `education-training-grants.ts` / `environmental-climate-grants.ts` / `health-grants.ts` / `minority-farmer-grants.ts` — orphaned, zero production callers (RESOLVED in Phase 5.4)

- **Root cause classification:** built-and-shelved; no code bug.
- **Fix applied (Phase 5.4):** extracted `persistGrantsGovHits()` out of `grantsgov-sync.ts`; wired all 4 as a 5th, **sequential** branch in `government-grants.ts` (Agent 14) — sequential specifically to avoid a double-insert race with the existing generic Grants.gov branch on the same `externalId` dedup key. See Phase 5.4's own record for the full detail; re-verified still correct and typechecking clean in this pass.

## 5. `final-assembly.ts` (AG-09) — zero production callers (RESOLVED in Phase 5.4)

- **Root cause classification:** built-and-shelved; no code bug.
- **Fix applied (Phase 5.4):** new `/api/agents/final-assembly` route, fired best-effort from `pipeline.ts`'s `executeTransition()` on submission, alongside the 3 existing same-pattern triggers.

## 6. `grants-gov.ts` — confirmed indefinite hang (RESOLVED in Phase 5.4)

- **Root cause classification:** dead upstream host (`apply07.grants.gov`, decommissioned legacy REST endpoint), not a timeout/retry bug per se.
- **Fix applied (Phase 5.4):** rewired onto the already-verified-live v1 `search2` client; removed the detail/backfill passes that depended on the dead detail endpoint.

## 7. `state-portal.ts` — TX portal 404 (RESOLVED in Phase 5.4 — was already fixed, comment was stale)

- Same pattern as issues #1 and #3: the underlying `portal-registry.ts` URL was corrected a day after the "404" comment was written; live-reverified 200 today. Comment corrected, no code change needed.

## 8. BEN-DIS-02 / BEN-DIS-08 / BEN-INT-10 / BEN-REL-07 / BEN-REL-08 — built, orphaned from the live orchestration graph (RESOLVED in Phase 5.4)

- **Root cause classification:** missing entry point into the delegation graph (stage list / dimension map / sibling `childAgentCode` call), not a code bug — every `execute()` body was already real.
- **Fix applied (Phase 5.4):** `BEN-SUP-03.ts` stage 1 expanded to include DIS-02/DIS-08; `BEN-INT-01.ts` gained the missing `hasContactInfo` gap-check delegating to INT-10; `BEN-REL-01.ts` gained an entity-type-gated delegation to REL-07 and an unconditional delegation to REL-08.

## 9. AG-05/06 Draft Generation — dead chain call (RESOLVED in Phase 5.4)

- **Root cause classification:** dispatcher missing a case for a literal string 3 separate producers already queue.
- **Fix applied (Phase 5.4):** added the `'ag-05-draft'` case to `routeQueueItem()`.

---

## 10. `simpler-grants.ts` — missing API key (OPEN — requires human action, not fixable in-session)

- **File:** `src/lib/agents/simpler-grants.ts`
- **Symptom:** throws `missing_api_key` before any fetch — `process.env.SIMPLER_GRANTS_API_KEY` is unset.
- **Root cause classification:** genuinely missing external credential. Confirmed via `vercel env ls production`: **absent** from Vercel production env (also absent from `.env.local`). The file's own header already documents this correctly (a real, confirmed 401 as of 2026-08-05, not a code-side header-name mistake — Simpler Grants and Grants.gov are different hosts with different, correctly-implemented auth requirements).
- **What's needed:** a human must register for API access at simpler.grants.gov (or wherever Simpler Grants issues keys), then set `SIMPLER_GRANTS_API_KEY` in both `.env.local` (local dev) and the Vercel production project's environment variables (`vercel env add SIMPLER_GRANTS_API_KEY production`).
- **Priority:** blocker for this one agent only; does not block anything else. **Not fixed** — flagged for human action.

## 11. `email-parser.ts` — Gmail auto-ingestion not built (OPEN — scoped future feature, not a bug)

- **File:** `src/lib/agents/email-parser.ts`
- **What exists today:** Phase 3 — processes email data passed to it directly (manual input path). This is real, wired, and correct for what it claims to do.
- **What's missing:** Phase 4 — "actual Gmail API integration" (per the file's own header), i.e. a push-notification/webhook pipeline that would auto-ingest inbound funder emails without a human pasting them in.
- **Root cause classification:** this is not a bug in the shipped Phase 3 scope — it is unbuilt future work. Building it for real requires: a Google Cloud project with the Gmail API enabled, an OAuth consent screen, a Pub/Sub topic + `users.watch()` registration per connected mailbox, and a verified public webhook endpoint (Google requires domain ownership verification for push notifications). All of that is human-side registration/configuration, not something achievable by writing code alone in this session.
- **Why it was not fabricated:** this codebase's own culture (`BEHAVIORAL_CONTRACTS §9`, referenced throughout) is explicit about never fabricating functionality. Writing a fake or half-wired Gmail webhook (e.g., pointing at an unregistered Pub/Sub topic) would be worse than leaving Phase 3 as the honest, current state — it would look done without being done.
- **Priority:** not a blocker (Phase 3 works correctly for manual use); a real feature-scope decision for Reid, requiring Google Cloud registration before any code work can proceed. **Not fixed** — flagged for human action + a dedicated future build.

## 12. `community-need-predictor-agent.ts` (AG-35) — uses `web_search` as a stand-in for 7 unbuilt data adapters (OPEN — deliberate, safe design choice, not a bug)

- **File:** `src/lib/agents/community-need-predictor-agent.ts`
- **What exists today:** the agent's own header states AG-35 is "still PLANNED per AGENTS_v2.md and depends on ingestion adapters [that don't exist yet]," and documents using Claude's `web_search` tool as a deliberate stand-in. The code explicitly discards any Claude response that didn't actually issue a `web_search` call, specifically to avoid persisting fabricated signals — this is a safety mechanism, not a shortcut taken carelessly.
- **What's "missing":** dedicated, real integrations with Census Bureau, HUD, BLS employment data, FEMA disaster declarations, and 3 other named data sources, each of which needs its own API key registration and response-mapping work.
- **Root cause classification:** scoped-smaller-than-ultimate-vision, by deliberate and documented design — not a defect. The agent never fabricates; it just doesn't yet have the ideal dedicated adapters.
- **Why it was not fabricated:** same reasoning as issue #11 — building 7 real government-data integrations, each requiring its own API registration, is a multi-week feature program, not a same-session fix, and faking any of them would violate this codebase's own "never fabricate" principle more severely than leaving the documented, safe `web_search` stand-in in place.
- **Priority:** not a blocker (the agent works correctly and safely today); a product-scope decision for Reid on whether/which real adapters to build, each gated on registering for that data source's API. **Not fixed** — flagged as a scope decision, not a bug.

## 13. `foundation-finder.ts` — hardcoded to 2 static directory URLs (RECLASSIFIED — not a bug)

- Real, wired, functioning exactly as designed: fetches 2 known, real, free foundation-directory pages and extracts opportunities via Claude. Narrow scope is not the same as broken. Reclassified from the prior audit's `NEEDS-WORK` to `PRODUCTION-READY` with a documented scope-limitation note. Not expanded with additional URLs in this pass — inventing directory URLs without verifying they're real and scrapable would risk fabricating a source, which this session avoided.

---

## Bonus findings — 2 additional real bugs found and fixed during verification (not in the original issue list)

These were not in Phase 5.4/5.5's target list; they surfaced because Phase 4's "must be all passing" test gate forced a genuine diagnosis of 2 pre-existing test failures rather than dismissing them.

### 14. `funders.city` / `funders.state` — test asserted a schema gap that had already been fixed

- **File under test:** `src/lib/autoapply/auto-queue-populator.ts` (line 195, selects `funders.city, funders.state`); test in `src/__tests__/integration/autoapply-compliance.test.ts`.
- **What the test claimed:** neither column exists in production, so `populateQueue()` throws for every organization — meaning the entire state-based AutoApply compliance-hold filter could never run at all.
- **Diagnosis:** verified via both a direct `psql` query and a raw `curl` against the production PostgREST endpoint — both columns exist and are served correctly (`{"city":null,"state":null}`). The schema gap had already been closed; the test was simply never updated to match.
- **Fix applied:** rewrote the test's assertion to reflect the real, current, working behavior (a successful empty-array result for a fixture org with no funder rows) instead of asserting a throw that no longer happens.
- **Real-world impact of the fix:** confirms the AutoApply compliance-hold pipeline — a genuine legal/compliance feature (charitable-solicitation state registration enforcement) — is not silently broken in production as the stale test implied.

### 15. `cross_client_blocked` — a live integration test's own success condition was incomplete

- **File under test:** `worker/queue-processor.ts`'s `processItem()`; test in `src/__tests__/integration-live/autoapply-queue-live-worker.test.ts`.
- **What the test expected:** a "ready" org's queue item should reach `pending_manual` status or create an `automation_sessions`/`autoapply_submissions` row, proving it passed the `org_not_ready` readiness gate.
- **What actually happened:** the item was correctly skipped with `cross_client_blocked: Another organization submitted to httpbin.org in the last 7 days` — a real, working anti-detection safeguard that prevents multiple client orgs from hitting the same shared external test target in a way that could look like coordinated automation abuse to that target.
- **Diagnosis:** read `queue-processor.ts` directly and confirmed `checkOrgReadiness()` (line 701) runs strictly before `checkCrossClientDedup()` (line 749) — reaching the cross-client check is conclusive proof the item passed the readiness gate the test exists to verify. The test's own fixed target URL (a shared public form, reused by every run of this suite and by manual diagnosis) makes this outcome close to inevitable once any org has submitted to it within the 7-day window — this is not a flake, it's the guard correctly doing its job.
- **Fix applied:** added `error_message` to the polling helper's `SELECT`, and added `row.status === "skipped" && error_message.startsWith("cross_client_blocked")` as a 4th valid proof of reaching the real pipeline, alongside the 3 the test already checked.
- **Live-verified:** manually reproduced the exact fixture via direct SQL (bypassing the test harness) to confirm the real worker's real behavior before touching the test, then re-ran the fixed test twice against the live Railway worker — both times green.
