# PT-05 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full detail and how each number was produced, see `PHASE-05-SUMMARY.md` in this same
directory. This doc is the short version: what environment now exists, why it's a local stack
instead of a Supabase branch, and what a future phase needs to know to use it.

## What exists now

A running local Postgres 17 + GoTrue + PostgREST stack (`.pt05-local-stack/`, Docker containers
suffixed `_pt05-local-stack`), reachable at `postgresql://postgres:postgres@127.0.0.1:56322/postgres`
and `http://127.0.0.1:56321`. It is **not** production and independently verified as such two ways
(connection-string check + a live `inet_server_addr()` query from inside the open session) — see
`environment.txt`.

Two clean orgs, each with a real owner-role user (created via GoTrue's admin API, not a raw
`auth.users` insert) and one seeded row in each of the six tenant-scoped tables the task named:
`applications`, `opportunities`, `draft_versions`, `contacts`, `donor_discovery_prospects`,
`deadlines`. Both orgs' data was re-confirmed by a fresh, independent query in
`verify-pt05-001.mjs` — not just trusted from the provisioning script's own printed counts.

## Why local, not a Supabase branch

The MCP-connected Supabase account genuinely does not have the `benavora` project on it — only two
unrelated projects (`tarritrix`, `tarritrix-audit`). There was no `project_id` to pass to
`create_branch` at all, so this wasn't a judgment call about whether to spend real money on a branch
— the credential path simply isn't available to this session. The task explicitly names "local
stack" as the fallback for exactly this case.

## What a future phase should know before using this environment

- **This is a hand-built minimal schema, not a full production replica.** It has 11 tables (the 6
  named tenant-scoped tables + `organizations`, `profiles`, `funders`, `donor_discovery_directory`,
  `donor_discovery_requests`) out of production's real 184. If a later phase needs a table this
  environment doesn't have, extend `pt05-schema.sql` using the same method this phase used — read
  the real columns/types/FKs straight out of `test-evidence/pt-06/live-schema.json` and
  `integrity.json` rather than guessing, and read any enum labels live and read-only from production
  the same way (see the `pg_enum` query in `PHASE-05-SUMMARY.md`).
- **No RLS policies were applied.** This phase's task was org/user/row provisioning only; row-level
  security enforcement (if a future phase needs to test it) is a separate build step against this
  same schema.
- **It was deliberately left running, not torn down**, since the whole point of this phase is to
  hand a live, seeded, isolated environment to whatever comes next. `docker ps` will show it
  alongside two unrelated pre-existing local stacks on this machine (`dialtest`,
  `ai-book-factory`) — don't confuse them; only the `_pt05-local-stack`-suffixed containers belong
  to this phase.
- **Re-running the provisioning script against the same stack will create a second pair of orgs**,
  not upsert the first — org names aren't unique-constrained in this schema (matching production).
  If a future phase wants a truly clean slate, either `supabase stop && supabase start` from inside
  `.pt05-local-stack/` first, or read `environment.txt`/`seed-summary.json` to reuse the org/user
  IDs that already exist.

## Recommendation

Nothing needs Reid's decision here — this phase produced infrastructure, not a finding. The one
thing worth flagging: whichever phase comes next and actually exercises this environment for
cross-tenant isolation testing should decide up front whether it needs RLS policies applied to this
schema, since none exist yet.
