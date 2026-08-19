# PT-02 — Branch Strategy for Write/CRUD Tests

Preflight determination for the write/mutation-checking phase this classification enables. This
document records what was checked, what was found, and the resulting hard rule for every future
session that runs a write test against a route classified `isMutation: true` in
`test-evidence/pt-02/api-routes.json` (231 of 318 routes).

## What was checked (read-only, non-destructive)

Two independent Supabase access paths exist in this environment; both were checked live before
writing this plan, neither was used to create or modify anything:

1. **The connected Supabase MCP server** (`mcp__claude_ai_Supabase__*` tools, this session).
   `list_projects` returned exactly 2 projects — `tarritrix` (`jhiplicikizdpdsguimg`) and
   `tarritrix-audit` (`hacsgiylclthwqzbktoe`) — both on organization `vlipoynwopxlkdbnwpug`.
   **Neither is Benavora.** This confirms the standing project-memory finding
   (`benavora-supabase-mcp-unauthorized`): the MCP connector in this session is authorized for a
   different Supabase account than the one Benavora's real project lives on. **The MCP
   `create_branch`/`confirm_cost` tools cannot be used for this project as currently connected.**

2. **The Management API PAT documented in `STANDING_DIRECTIVES.md` DIRECTIVE-017, Path 2**
   (`sbp_7f7e9e00...`, last 6 chars `895d2`). Live-checked with two plain `GET` requests, no
   mutation of any kind:
   - `GET https://api.supabase.com/v1/projects` → `200`, 4 projects returned, including
     `vbjplpquqxxfbpazyalt | benavora | ACTIVE_HEALTHY` — **this token is authorized for the
     real Benavora project**, on organization `upwvnvezkhsktmrzqlpd` ("reid@repvg.com's Org"),
     confirmed on the **`pro`** plan (`GET /v1/organizations/upwvnvezkhsktmrzqlpd`).
   - `GET https://api.supabase.com/v1/projects/vbjplpquqxxfbpazyalt/branches` → `200`, `[]`.
     A `200` with an empty array (not a `402`/`403` "branching not available on this plan" error)
     confirms **branching is available for this project today**, and zero branches currently
     exist.

## Determination

**A Supabase branch CAN be created for Benavora via the Management API using the Path 2 token.**
The MCP connector cannot do this (wrong account); the raw Management API can. No branch was
created during this preflight check — creating one is a real, billed, non-instant action
(`create_branch`'s own description: "This will apply all migrations from the main project to a
fresh branch database... Note that production data will not carry over"), correctly out of scope
for a classification-only step. This section only establishes that the capability exists and how
to use it when a future phase actually needs it.

## The plan for the future write-test phase

When a future PT phase actually executes mutation checks against the 231 `isMutation: true`
routes in `api-routes.json`:

1. Create a dedicated branch via `POST /v1/projects/vbjplpquqxxfbpazyalt/branches` with the Path 2
   PAT (`Authorization: Bearer <token>`, body `{"branch_name": "audit-write-tests"}` or similar).
   This provisions a fresh database with all of Benavora's migrations applied and its own,
   independent `project_ref` / connection credentials — structurally isolated from production,
   not a shared schema or a soft "test mode" flag.
2. Point every write/CRUD check at the **branch's own project_ref and its own Supabase URL/keys**
   (returned in the `create_branch` response), never at `vbjplpquqxxfbpazyalt`.
3. After the write-test pass completes (pass or fail), delete the branch
   (`DELETE /v1/branches/{branch_id}`) so it doesn't accrue ongoing compute cost.
4. Since production data does not carry over to a branch, any check that depends on real
   production row content (not just schema) cannot be exercised on the branch as-is — that
   sub-case is recorded `PENDING-SCOPE` per route until either (a) a minimal realistic seed is
   written for the branch, or (b) the check is redesigned to be self-seeding (create its own
   fixture row via a safe, RLS-scoped mutation, then check the fixture, then clean up — the same
   pattern this repo's own live-verification sessions already use for production-adjacent testing,
   per `STATE_OF_THE_BUILD.md`'s many "create disposable org/user, test, delete afterward, confirm
   deletion" precedents).

## Hard rule, unconditional

**No mutation check in any future audit phase may run against the production project ref
(`vbjplpquqxxfbpazyalt`) or against production data.** Every `isMutation: true` route's write
path is exercised only against a disposable branch (per the plan above), or is marked
`PENDING-SCOPE` if branch provisioning is not actually performed in that phase. `GET`-only routes
(87 of 318, `isMutation: false` in `api-routes.json`) are not subject to this restriction and may
be read against production the same way PT-01's live checks already were (real authenticated
session, real response inspected, nothing written) — this rule is specifically about routes that
write.

## Scope of this document

This is a preflight determination only. **PT-02 itself does not execute any write test** — it
only classifies which of the 318 API routes are mutations (`isMutation: true` in
`api-routes.json`) and records, here, how a future phase should safely test them. No branch has
been created as of this writing; no mutation check has been run against any environment.
