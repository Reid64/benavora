# STATE_OF_THE_BUILD.md
## BENAVORA -- Current Build Status (compacted 2026-08-25, post-Queue-B)

**Current production deploy (app code):** SHA `4957040`, `https://www.benavora.com`, READY (Session 30, 2026-08-23). PIL-02/PIL-03 agent code (commits `670fca8`..`8344f3f`) is merged to `main` and pushed to `origin/main` but has **not** been deployed via `vercel --prod` -- production still serves pre-PIL code for the PIL routes.

**Local `main` branch:** HEAD `8344f3f`, even with `origin/main` (0 commits ahead -- already pushed by the prior FORGE session).

---

## PIL migration status

Migrations 150-161 (PIL-01, 12 files) are live in production Postgres: 31 `pil_*` tables confirmed via `information_schema.tables`, `pil_agent_registry` seeded with 44 rows, all 12 versions recorded in `supabase_migrations.schema_migrations`. Deferred-FK ALTERs and a `get_advisors` RLS pass on the 31 tables are still outstanding (tracked as Queue C, pil-04-003).

## PIL-03 agent fleet: 34 of 44 registry agents implemented

Remaining unimplemented: `BEN-QLF-01/02/03/05`, all 4 `BEN-STR-*`, `BEN-KNW-04`, `BEN-OPS-01`.

---

## FORGE queue status (PIL rollout)

**Queue A** (`FORGE/projects/benavora/queue-pil-A.yaml`, prompts pil-02-001..005) -- **COMPLETE, 5/5 passed.** Infrastructure services (workflow engine, agent runner, graph service, PIL API routes), all 8 Family 1 Supervisory agents (BEN-SUP-01..08), Operator Command Center UI. Report: `FORGE/reports/benavora_2026-08-24_19-52-57.md`.

**Queue B** (`FORGE/projects/benavora/queue-pil-B.yaml`, prompts pil-03-001..007) -- **3 passed / 4 failed.** Report: `FORGE/reports/benavora_2026-08-24_21-01-29.md`, log: `FORGE/logs/benavora/build_2026-08-24_21-01-29.log`.
- PASSED: `pil-03-001` (tool infrastructure), `pil-03-002` (BEN-DIS-01..05), `pil-03-004` (BEN-INT-01..08)
- FAILED (all 3 retries exhausted): `pil-03-003`, `pil-03-005`, `pil-03-006`, `pil-03-007`
- **Root cause of all 4 failures:** the queue's own `file_exists` gates demand agent files (`BEN-DIS-10.ts`, `BEN-INT-15.ts`, `BEN-REL-07.ts`/`BEN-REL-08.ts`, `BEN-QUA-01.ts`) whose agent codes do not exist in the 44-agent registry (`pil_agent_registry` / `PROSPECT_INTELLIGENCE_AGENTS.md` cap each family lower than the queue prompts assume). The Build Agent correctly built the real, in-registry agents each time (BEN-DIS-06..08, BEN-INT-09..10, BEN-REL-01..06, BEN-QLF-04/BEN-KNW-02/BEN-KNW-03) and refused to fabricate nonexistent codes, so the underlying work is done and committed -- only `queue-pil-B.yaml`'s gate file lists are wrong. All 34 real agents from this batch are on `main` (commits `13113f6`..`8344f3f`, pushed).
- **Not yet done:** fix or drop the mismatched `file_exists` gate entries in `queue-pil-B.yaml`/`queue-pil-B-v2.yaml` (or accept the 4 as false-positive fails) before treating Queue B as closed.

**Queue C** (`FORGE/projects/benavora/queue-pil-C.yaml`, prompts pil-04-001..003) -- **STAGED, not yet run.** Prospect dossier UI + D3 graph visualization + evidence inspection UI (pil-04-001); monitoring dashboard, agent kill switch, evaluation framework (pil-04-002); production hardening -- RLS/index verification, migration 163, push + `vercel --prod` deploy + live smoke test (pil-04-003, the only queue step authorized to push/deploy).

**forge2-pil-d01** (`C:\Users\manag\Downloads\Recent Downloads\forge2-pil-d01-20260824.yaml`, project `pil-system`, prompts pil-d01-001..007) -- **DOWNLOADED, not yet launched in forge-2.** Isolated PIL repo bootstrap; BEN-STR-01..08 Strategy family; BEN-QLF-01..05 Qualification family + orchestrator; BEN-KNW-03/04 + BEN-OPS-01; advanced tool infra (SEC EDGAR, real estate, DAF, matching gifts, foundation history); comprehensive eval suites; independent LLM verification package.

---

## Open P0 findings (3) -- full detail/evidence/repro in WIRING_GAP_REGISTER.md

- **WGR-023** -- `src/middleware.ts` has no explicit exemption list for `/api/cron/*`, `/api/sources/*`, `/api/webhooks/*`, `/api/admin/webhooks/*`; each route only reaches its own secret check today because it also requires a session cookie -- real cron/webhook callers may not carry one. CONFIRMED-BROKEN.
- **WGR-074** -- Admin impersonation's `impersonation_org_id` cookie is read by zero other call sites; starting impersonation does not itself restrict which org an owner can reach. CONFIRMED-BROKEN.
- **WGR-167** -- Manual browser-automation trigger (`POST /api/agents/automation`) launches Playwright Chromium inside the Vercel serverless function, which has no Chromium binary -- 100% non-functional in prod. Does not affect the working Railway `worker/queue-processor.ts` AutoApply pipeline. CONFIRMED-BROKEN.

---

## Marketing site

Current and healthy. 23/23 marketing routes returned live HTTP 200 with non-empty titles against `https://www.benavora.com` (Session 27, 2026-08-23, `test-evidence/verification/final/smoke.json`). mkt-002 (20 MDX pages + catch-all route), mkt-003 (home page), and mkt-08/knw-003 (Assist chatbot widget) are built and live. The Assist chatbot **backend** is still broken in prod (`WGR-174`, migration `147_knowledge_public_wrappers.sql` never applied -- unrelated to the PIL work above).

---

*Full P1/P2/P3 findings, session-by-session narrative, and original audit-close snapshot: `test-evidence/_register/WIRING_GAP_REGISTER.md` (permanent record). See `SESSION_STATE.md` for next actions and blockers.*
