# PT-05 — Phase 05 Summary (Isolation Environment: Branch/Local, Two Test Orgs)

Consolidated numbers for the PT-05 phase. Every number below cites the evidence artifact it came
from — re-run the cited verifier or read the cited file directly to reproduce it; nothing here is
asserted from memory.

## Scope

PT-05 provisions a real, isolated database environment — separate from production
(`vbjplpquqxxfbpazyalt`) — seeded with two clean test organizations, each with an owner-role user
and rows in the core tenant-scoped tables PT-06 confirmed exist in the real schema (`applications`,
`opportunities`, `draft_versions`, `contacts`, `donor_discovery_prospects`, `deadlines`). This is
infrastructure for a later phase to run real cross-tenant isolation tests against, not itself a
findings-producing audit step — no rows were added to `WIRING_GAP_REGISTER.md`.

## Preflight

PT-00's `test-evidence/pt-00/route-manifest.json` (464 routes, generated 2026-08-19) and PT-06's
`test-evidence/pt-06/live-schema.json` (184 tables / 2,226 columns, live-queried 2026-08-20) and
`integrity.json` (267 FK constraints with live orphan checks, including a `tenant_fk_gap` check —
120 of 184 tables carry a real tenant column, 13 are missing their FK) were both confirmed present
and non-empty before this phase started. Both PT-00 and PT-06 have real content — no HALT was
needed.

## Environment decision: local Supabase CLI stack, not a Supabase branch

The task's preferred path — `Supabase:create_branch` via the connected MCP server — was checked and
found unavailable this session, for a concrete, verifiable reason, not skipped by choice:
`mcp__claude_ai_Supabase__list_projects` returned only two unrelated projects (`tarritrix`,
`tarritrix-audit`, org `vlipoynwopxlkdbnwpug`) — the connected account does not have the real
`benavora` project on it at all, so there is no `project_id` this session could pass to
`create_branch` in the first place, independent of the separate `confirm_cost_id` real-money-cost
consent step that command also requires.

Fell back to the explicitly-allowed alternative: a local Supabase CLI stack. Docker Desktop was
already running (`docker ps` showed two other local stacks live on this machine, `dialtest` and
`ai-book-factory`). Initialized a fresh, standalone CLI project in `.pt05-local-stack/` (outside any
tracked directory — not `supabase/` or `src/supabase/`, so this cannot collide with or alter either
of the repo's two real migration trees), remapped every port in its `config.toml` from the CLI's
`543xx` defaults to `563xx` to avoid colliding with the two stacks already running, and ran
`supabase start`. Result: a real, running Postgres 17 + GoTrue + PostgREST stack at
`postgresql://postgres:***@127.0.0.1:56322/postgres` (`API_URL` `http://127.0.0.1:56321`).

## Target verification — not the production ref

Verified the local stack is not production two independent ways, both recorded in
`environment.txt`:
1. **String check**: the connection string's host (`127.0.0.1`) does not contain the production ref
   `vbjplpquqxxfbpazyalt` (`db.vbjplpquqxxfbpazyalt.supabase.co`, the host PT-06's own
   `connection-proof.txt` used for the real production connection).
2. **Live check, from inside the connection itself**: `select inet_server_addr()` on the actual
   open connection returned `172.22.0.2` (a Docker-internal private address), not a public Supabase
   cloud host — confirming the string wasn't just pointed somewhere else while the live session
   quietly reconnected elsewhere.

`scripts/audit/verify-pt05-001.mjs` hard-fails if the production ref appears in `environment.txt`
or `seed-summary.json` outside an explicit negative-comparison line, and hard-fails if a live
re-query's `server_addr`/`current_database` looks production-shaped.

## Schema applied

`scripts/audit/pt05-schema.sql` — a real-shaped subset of the production `public` schema, built
directly from PT-06's own live column dumps (`live-schema.json`) and FK map (`integrity.json`), not
guessed: `organizations`, `profiles` (FK'd to `auth.users.id`, matching the real
`profiles.id -> users.id` constraint PT-06 found), `funders`, `opportunities`, `applications`,
`draft_versions`, `contacts`, `donor_discovery_directory`, `donor_discovery_requests`,
`donor_discovery_prospects`, `deadlines`, plus the 10 real enum types those tables depend on
(`user_role`, `funder_category`, `opportunity_status`, `pipeline_stage`, `draft_template_type`,
`humanization_status`, `contact_relationship`, `donor_discovery_pipeline_stage`,
`donor_discovery_request_status`, `deadline_type`) — enum labels read live, read-only, from the
real production database (`SET default_transaction_read_only = on` before the query, same
enforcement pattern PT-06-001 established) rather than assumed.

## Two test orgs, seeded

`scripts/audit/pt05-001-provision-isolation-env.mjs` created:

| Org | Org ID | Owner user (real `auth.users` row via GoTrue Admin API) | Role |
|---|---|---|---|
| A | `10b809c1-fc40-4a7b-a6c1-7c4e8eebe850` | `9cbf4577-2cc6-4cc0-8f67-911f5ea648ff` (`pt05-owner-a@benavora-pt05-test.local`) | owner |
| B | `0fdd7a7d-6214-4d54-bca2-40239e0146f9` | `1f0ce691-8a5c-41a9-a3e7-1736c43ee231` (`pt05-owner-b@benavora-pt05-test.local`) | owner |

Both users were created via `POST /auth/v1/admin/users` against the local stack's GoTrue instance —
the same real provisioning path production uses — not a raw `INSERT INTO auth.users`, so both are
genuine, complete auth users, not synthetic FK-satisfying rows.

Each org was seeded with exactly one row in each of the six tenant-scoped tables named in the task
(plus the minimal supporting parent rows their real foreign keys require — one `funders` row per
org, one `donor_discovery_directory` row, one `donor_discovery_requests` row):

| Table | Org A | Org B |
|---|---|---|
| `applications` | 1 | 1 |
| `opportunities` | 1 | 1 |
| `draft_versions` | 1 | 1 |
| `contacts` | 1 | 1 |
| `donor_discovery_prospects` | 1 | 1 |
| `deadlines` | 1 | 1 |

## Independent re-verification, not trusted from the provisioning script's own output

`verify-pt05-001.mjs` does not read `seed-summary.json`'s counts as the final answer — it opens a
fresh connection to the recorded local target and re-`COUNT(*)`s each table per org directly, and
separately re-confirms each org has a `profiles` row with `role = 'owner'` joined to a real
`auth.users` row. All checks passed on a fresh run (see `verify-run.log`).

## Evidence files

- `test-evidence/pt-05/environment.txt` — target proof (string + live check), org/user creation log.
- `test-evidence/pt-05/seed-summary.json` — machine-readable org IDs, user IDs, per-table counts.
- `test-evidence/pt-05/verify-run.log` — output of the final `verify-pt05-001.mjs` run.
- `scripts/audit/pt05-schema.sql` — the applied schema.
- `scripts/audit/pt05-001-provision-isolation-env.mjs` — the provisioning script (idempotent to
  re-run against a fresh local stack; not idempotent against the same stack twice, since org names
  aren't unique-constrained — intentional, matches every other provisioning script in this repo).
- `scripts/audit/verify-pt05-001.mjs` — the verifier.

## Left running, not torn down

The local stack (`.pt05-local-stack/`, Docker containers suffixed `_pt05-local-stack`) was left
running after this phase, on the assumption a later phase will run real isolation tests against it.
It is not part of the scoped commit (only `test-evidence/`, `scripts/audit/`,
`STATE_OF_THE_BUILD.md`, `SESSION_STATE.md` were staged) — `.pt05-local-stack/` is local-machine
Docker state, not repo content, and was not added to `.gitignore` since it was never staged in the
first place. If a future session needs this environment gone, `docker compose -p pt05-local-stack
down -v` (or `supabase stop` from inside `.pt05-local-stack/`) tears it down cleanly.

---

## PT-05-002 — Cross-Tenant Read Attempts, All Tenant-Scoped Tables

Authenticated as Org A's real user, attempted to READ Org B's rows on every tenant-scoped table
PT-06 identified. Every number below cites the evidence artifact it came from.

### Scope: every tenant-scoped table, derived independently from PT-06's live schema

`test-evidence/pt-06/live-schema.json` (184 tables) was scanned for `organization_id`/`org_id`
column presence, independently of any prior list — **120 tables** carry a tenant column. Of
those, PT-06's `integrity.json` `tenant_fk_gap` check flags **13** as missing their live foreign
key to `organizations` (`adapter_usage_log`, `agent_configurations`, `autoapply_review_queue`,
`board_meeting_packets`, `board_meetings`, `discovery_matches`, `funding_forecasts`,
`impact_simulations`, `knowledge_queries`, `opportunity_probability_scores`,
`organizational_digital_twins`, `pitch_cache`, `submission_receipts`) — this task's named "prime
suspects", given extra scrutiny below.

### Ground truth: real production RLS policy state, fetched read-only

Before any local testing, `scripts/audit/pt05-002-fetch-production-rls.mjs` connected read-only to
production (same `SET default_transaction_read_only = on` method PT-06-001 proved) and read
`pg_class.relrowsecurity`/`pg_policies` for all 120 tenant tables — the real, live policy text
governing every real request today, not inferred from application code or convention.
`test-evidence/pt-05/production-rls-policies.json`. Result: **all 120 tables have RLS enabled**
(zero disabled); **116 carry at least one policy**; **4 carry zero policies at all**
(`ai_usage_log`, `enrichment_jobs`, `kb_extended_needs`, `system_errors` — see WGR-072, a deny-all
availability question, not a leak). Of the 116 with policies, every SELECT/ALL-command policy's
`qual` clause references the table's own tenant column compared against a current-org lookup — no
trivial (`true`) or tenant-column-blind predicate was found anywhere across all 120 tables.

### Tier 1 — live HTTP test, 20 tables (7 seeded by PT-05-001 + all 13 prime suspects)

`scripts/audit/pt05-002-schema-extension.sql` added `public.current_org_id()` (the exact real
production function, fetched via `pg_get_functiondef` — `test-evidence/pt-05/
current_org_id-function-def.txt`) and enabled RLS with the real production policy predicate
(byte-for-byte, fetched read-only, not reconstructed from memory) on the 7 tables PT-05-001 seeded
(`funders`, `opportunities`, `applications`, `draft_versions`, `contacts`,
`donor_discovery_prospects`, `deadlines` — none had RLS applied by PT-05-001) plus all 13 prime
suspects, newly created locally with columns copied verbatim from `live-schema.json` and
**deliberately no foreign key on the tenant column**, matching production's real (flawed) state
exactly rather than papering over the condition under test.
`scripts/audit/pt05-002-provision-and-seed.mjs` seeded one real row per org into each of the 13
new tables (reusing Org A/B's existing funder/opportunity rows for FK targets where required),
recording every seeded row id to `test-evidence/pt-05/cross-tenant-seed-ids.json`.

`scripts/audit/pt05-002-cross-tenant-read.mjs` then logged in as Org A's real user via GoTrue
password grant (a real JWT, not forged) and, for each of the 20 tables, attempted two things:
1. **Positive control** — Org A reading its OWN seeded row, via both `@supabase/supabase-js`
   ("API layer") and a raw PostgREST `fetch` ("direct PostgREST"). Confirms the RLS/`auth.uid()`
   wiring is actually live for that table, not just globally denying everything.
2. **Cross-tenant read attempt** — Org A attempting to read Org B's known seeded row id, same two
   paths.

**Result: 20/20 tables blocked, 0 leaks.** Every cross-tenant attempt returned `row_count: 0`,
`HTTP 200` (an empty result set — standard PostgREST/RLS behavior, not an error), on both the API
layer and direct PostgREST paths, while every same-table positive control correctly returned
`row_count: 1`. This holds for all 13 tenant_fk_gap prime suspects, not just the 7 originally-
seeded tables — the missing tenant→organizations foreign key does not correspond to a missing or
broken RLS policy; the two are separate enforcement mechanisms and only referential integrity is
absent on those 13.

### Tier 2 — production RLS policy inspection, remaining 100 tables

Not live-seeded in this local environment (seeding and RLS-replicating all 120 production tables
was out of reasonable scope for this phase). Verdict derived from the same real, live production
RLS state fetched above — 96/100 carry a correctly org-scoped SELECT/ALL policy; the other 4 are
the zero-policy tables already noted. Every row is explicitly labeled `method:
"production_rls_policy_inspection_readonly"` with `returned_row_count: null` so it can never be
confused with a Tier 1 empirical result.

### Findings

- **WGR-071** (P3, CONFIRMED-OK) — the overall clean result: 0/120 tenant tables show a
  cross-tenant read leak, including all 13 prime suspects live-tested.
- **WGR-072** (P3, PENDING-SCOPE) — the 4 zero-policy tables (`ai_usage_log`, `enrichment_jobs`,
  `kb_extended_needs`, `system_errors`) deny SELECT to everyone, including the owning org; not
  investigated further whether this is intentional (service-role-only) or a missing policy.

### Evidence files

- `test-evidence/pt-05/production-rls-policies.json` — real production RLS ground truth, all 120 tables.
- `test-evidence/pt-05/current_org_id-function-def.txt` — the real `current_org_id()` definition.
- `test-evidence/pt-05/cross-tenant-seed-ids.json` — per-table, per-org seeded row ids used as read targets.
- `test-evidence/pt-05/cross-read.json` — full per-table results, all 120 tables, both tiers.
- `scripts/audit/pt05-002-fetch-production-rls.mjs`, `pt05-002-fetch-function-defs.mjs`,
  `pt05-002-schema-extension.sql`, `pt05-002-provision-and-seed.mjs`,
  `pt05-002-cross-tenant-read.mjs` — the full pipeline, each independently re-runnable.
- `scripts/audit/verify-pt05-002.mjs` — the verifier (independently re-derives the expected table
  list from `live-schema.json` rather than trusting `cross-read.json`'s own list; requires every
  prime-suspect table be `live_http_test`'d, not just policy-inspected; cross-checks every
  `row_count` against its own captured `raw_rows` payload; live re-checks the local stack still
  exists).
