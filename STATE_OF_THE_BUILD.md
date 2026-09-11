# Benavora Platform Build State

## PHASE 1 FIXES — scoring foundations repair (2026-09-11)

Verified via 2 independent audit passes (static: tsc/tests/code review; live: real API calls + real DB queries against org `b1ab7402-dfc2-4712-869f-70ea3566cc1d`). **3 of 5 fixes are fully verified end-to-end; 2 are code-correct but blocked live by a database-access outage, not by the fix itself.**

1. **✅ VERIFIED — `ag-15-probability` agent_type enum value.** Migration 178 adds the enum value, `src/types/agents.ts` and `probability-scoring-agent.ts` agree on the literal. `tsc --noEmit`: 0 errors, 0 matches for probability/propensity/agent_type.
2. **❌ NOT VERIFIED (code correct, DB unreachable) — Success-probability agent write path.** Live `POST /api/agents/success-probability` still 500s: `write_failed`, Postgres `42P10` — no unique constraint on `success_probability_scores.application_id`. The fix (`supabase/migrations/149_success_probability_scores_unique_constraint.sql`, WGR-170) is written and correct but **was never applied to the live DB**. Every DDL path tried this session (psql on 5432/6543, pooler, Management API PAT, Supabase CLI, MCP connector, `exec_sql` RPC) failed — see "Known Issues" below.
3. **❌ NOT VERIFIED (code correct, DB unreachable) — Propensity-scoring batch route.** Live `POST /api/agents/propensity-scoring?batch=true` still 500s: `permission denied for table corporate_prospects`. Root cause is a missing `GRANT` for the `authenticated` role (not an RLS policy — `corporate_prospects` is intentionally unscoped/shared per migration 107, but the GRANT to `authenticated` was apparently never issued). Fix SQL identified (`GRANT SELECT, UPDATE (scores, scores_computed_at) ON corporate_prospects TO authenticated;`) but unapplied for the same DDL-access reason as #2.
4. **✅ VERIFIED — Relationship-score consolidation (Agent 23 + AG-19).** Both agents now call the same `computeRelationshipScore()` (`src/lib/intelligence/relationship-scorer.ts`) instead of independent formulas. Confirmed both statically (diff removes both agents' bespoke scoring code) and live: calling Agent 23 via HTTP then AG-19 directly on the same funder produced identical scores (0→20→40) both times. `relationship-graph-builder-agent.ts` (AG-32) is correctly out of scope — it never wrote scores, only graph nodes/edges, by design.
5. **✅ VERIFIED, with one new defect found — Outcome → recursive learning → proven_narratives.** `POST /api/outcomes` marking an application awarded successfully triggers `RecursiveLearningAgent`, which wrote 8 real `proven_narratives` rows. Confirmed `proven_narratives` is intentionally per-org isolated via RLS (`organization_id = current_org_id()`) — a different org scoped-query correctly returned zero rows. **New defect (not blocking, filed for Phase 2):** the triggering agent's own `agent_runs` row gets stuck at `status=running` forever when the agent takes >60s — `base-agent.ts`'s timeout race means the work finishes and writes data correctly, but the audit-trail status never flips to `completed`/`failed`. Any dashboard reading `agent_runs.status` will misreport these as hung.

**Gate results:**
- `pnpm tsc --noEmit`: ✅ 0 errors
- `pnpm test:unit` (full suite, `vitest run`, 92 files / 882 tests): 88 files / 866 tests passed, 3 failures — all pre-existing and unrelated to these fixes (1 AutoApply compliance test documenting a known prod schema gap `funders.city`/`state`; 2 correlated Supabase network-timeout flakes in `storage-rls`/`organizations` tests).
- Live functional gates: **3/5 passed**, 2/5 blocked on DB access (see above).

## Known Issues

**Live DDL access to the production Supabase project (`vbjplpquqxxfbpazyalt`) is completely unreachable from this environment as of 2026-09-11**, confirmed exhaustively this session: direct psql (both ports) rejects the stored password, the pooler rejects the tenant, the Management API PAT returns 401, the Supabase CLI/MCP connector are both authenticated to an unrelated account/org, and no `exec_sql` RPC exists on the DB. This blocks fixes #2 and #3 above and anything else requiring a live schema change. Needs a human with dashboard access (or a fresh service-role/Management API credential) to run the two SQL statements listed above, after which both routes should be re-verified with `scripts/audit/verify4-step3-success-probability.mjs` / `verify4-step4-propensity.mjs` (left in place from this audit).

**`agent_runs.status` unreliable for slow (>60s) agent runs** — `base-agent.ts`'s timeout handling races with in-flight work; found via the recursive-learning agent (see fix #5 above) but likely affects any agent whose work legitimately exceeds 60s.

Zoho integration not yet implemented (planned for Phase 2).

## AUTOAPPLY P0 FIXES COMPLETE

Full end-to-end loop tested and working. Gmail OAuth confirmation monitoring implemented. Resend email submission pipeline verified. Retry logic with hourly sweep added. Faith Foundation stuck submission from June recovered and logged.

## NEXT SESSION PRIORITIES (Phase 2)

1. **Restore live DDL access** — get a working DB password, Management API PAT, or Supabase CLI/MCP login scoped to `vbjplpquqxxfbpazyalt` (current CLI/MCP auth points at an unrelated account). This blocks everything below.
2. **Apply migration 149** (`success_probability_scores` unique constraint) once DDL access is restored; re-run `scripts/audit/verify4-step3-success-probability.mjs` to confirm the 500 is gone.
3. **Grant `authenticated` role access to `corporate_prospects`** (`GRANT SELECT, UPDATE (scores, scores_computed_at) ON corporate_prospects TO authenticated;`), author it as a proper migration file first; re-run `scripts/audit/verify4-step4-propensity.mjs`.
4. **Fix the `agent_runs` timeout race in `base-agent.ts`** so long-running agents (>60s) correctly transition to `completed`/`failed` instead of sticking at `running` — affects audit-trail/dashboard accuracy, not just recursive-learning.
5. Once 2-4 land, re-run the full live verification pass (success-probability, propensity-scoring batch) to close out Phase 1 fixes #2 and #3 as genuinely ✅ VERIFIED.

---

Last Updated: 2026-09-11
