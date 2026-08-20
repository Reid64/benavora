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
