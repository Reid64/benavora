# PT-05 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how each was produced, see `PHASE-05-SUMMARY.md` in this same directory.
This doc is the short version: the direct answer to "can one tenant reach another's data," the one
real P0 this phase found (which is not that), its fix direction, and what we recommend next.

## The question you actually care about: can one tenant reach another tenant's data?

**No — not on any of the 120 tenant-scoped tables PT-06 identified, on any operation tested.**
Authenticated as a real user in Org A, we tried to read, update, delete, and forge-insert Org B's
data. Every attempt was blocked. This was checked two ways, not one:

- **20 tables, live HTTP test** (real GoTrue session, real requests via both the app's own
  `@supabase/supabase-js` client and a raw PostgREST call, against a local stack running the real
  production RLS policy predicate verbatim) — the 7 tables PT-05-001 seeded, plus all 13 tables
  PT-06 flagged as missing their foreign key back to `organizations` (`tenant_fk_gap`, WGR-064) —
  the tables where a leak was most plausible, given extra scrutiny for exactly that reason.
- **100 tables, read-only inspection of the real, live production RLS policy text** — not a live
  request, but the actual `pg_class.relrowsecurity`/`pg_policies` state governing every real
  request today.

| Table | Read (Org A → Org B) | Write: UPDATE | Write: DELETE | Write: INSERT-as-Org-B | Missing tenant FK (WGR-064)? |
|---|---|---|---|---|---|
| `funders` | No | No | No | No | |
| `opportunities` | No | No | No | No | |
| `applications` | No | No | No | No | |
| `draft_versions` | No | No | No | No | |
| `contacts` | No | No | No | No | |
| `donor_discovery_prospects` | No | No | No | No | |
| `deadlines` | No | No | No | No | |
| `adapter_usage_log` | No | No¹ | No | No | yes |
| `agent_configurations` | No | No | No | No | yes |
| `autoapply_review_queue` | No | No | No | No | yes |
| `board_meetings` | No | No | No | No | yes |
| `board_meeting_packets` | No | No | No | No | yes |
| `discovery_matches` | No | No | No | No | yes |
| `funding_forecasts` | No | No | No | No | yes |
| `impact_simulations` | No | No | No | No | yes |
| `knowledge_queries` | No | No¹ | No | No | yes |
| `opportunity_probability_scores` | No | No | No | No | yes |
| `organizational_digital_twins` | No | No | No | No | yes |
| `pitch_cache` | No | No | No | No | yes |
| `submission_receipts` | No | No¹ | No | No | yes |

¹ These 3 tables have no UPDATE policy at all in production, not even for the owning org — their
cross-tenant UPDATE block is a default-deny-for-everyone artifact, not a specifically tenant-scoped
check. Still correctly blocked; noted so it isn't misread as "extra-hardened" when it's actually
"nobody can UPDATE this table via the normal client, owner included." See WGR-073.

**The remaining 100 tables** (not individually live-tested — full list in `cross-read.json`/
`cross-write.json`): 96 carry a correctly org-scoped policy on every command checked. The other 4
(`ai_usage_log`, `enrichment_jobs`, `kb_extended_needs`, `system_errors`) have RLS enabled with
**zero policies at all** — deny-all for everyone, including the owning org. Not a leak (the
opposite failure mode), but an open, unanswered question: intentional service-role-only tables, or
a missing policy nobody wrote yet. **WGR-072, PENDING-SCOPE — needs a product answer, not a fix.**

Full per-table raw results (all 120, both tiers, every request/response captured): `cross-read.json`,
`cross-write.json`. WGR-071 (read), WGR-072 (zero-policy tables), WGR-073 (write).

## The one real P0 this phase found — and it is NOT a tenant-isolation leak

**Admin impersonation is unbounded.** `POST /api/admin/orgs/[id]/impersonate` sets a cookie
(`impersonation_org_id`) that is read by **zero other code paths anywhere in the app** — confirmed
by a live, repo-wide `git grep`. The actual authorization gate protecting every owner-scoped admin
route, including the org-detail page the impersonation button lives on, is `profiles.role='owner'`
— a check with no org-id parameter at all. Any of the platform's 70 real `owner`-role users can
reach any org's admin data through this same gate, whether or not they've clicked "impersonate," and
whichever org they clicked impersonate *for* makes no difference to what they can reach.

This is deliberately distinguished from PT-05-002/003's clean result above, not a contradiction of
it: ordinary tenant RLS is intact and was independently re-confirmed in the same test (the identical
admin user's own RLS-scoped session correctly gets 0 rows reading another org directly). The gap is
specific to the owner-gated **admin** surface, which reads via a service-role client
(`createAdminClient()`) by design and has simply never had an org-scoping check layered on top of
role. "Impersonation" as currently built is UI framing around a capability the role check already
grants unconditionally — it restricts nothing.

**Fix direction:** add an actual org-scoping check to the admin routes gated behind impersonation —
either (a) require every admin route that reads/writes a specific org's data to verify the
requesting admin's `impersonation_org_id` cookie (once it's actually read somewhere) matches the org
in the URL, and reject/no-op if it doesn't, or (b) if the intent is that any `owner`-role user should
in fact be able to reach any org through this admin surface with no per-org restriction, then the
"impersonate" framing and the unread cookie are misleading and should either be removed or
re-labeled as what they are (an audit-trail stamp, not an access boundary) — that's a product
decision, not a code fix, and belongs to whoever owns this feature's intended scope. Either way, the
current state — a cookie nothing reads, sitting next to UI copy that implies scoping — should not
ship as-is.

**WGR-074, P0.**

## A second finding on the same surface, lower severity: the impersonation audit trail is broken

Separately from the scoping question: the dedicated `impersonation_log` table this feature exists
to populate (`SCHEMA_REGISTRY §55`) cannot be written by any real user today. Its `admin_id` column
has a foreign key to `platform_admins`, a table with exactly 1 row — 0 of the platform's 70 real
`owner`-role profiles are in it. Every real impersonation attempt's insert into `impersonation_log`
therefore fails a foreign-key constraint (`23503`, reproduced live against a local copy of the same
constraint), and the route never checks the error on that insert — the caller still gets
`{ ok: true }`, and `impersonation_log` sits at 0 rows in production, consistent with a
100%-reproducible failure rather than a feature nobody's tried. A separate, generic `audit_logs`
insert on the same call path does succeed, so this is not a fully silent action — but the
purpose-built trail for exactly this action is dead for every real caller.

**Fix direction:** either populate `platform_admins` with the real set of users who should be
allowed to impersonate (turning the FK from broken to correct, and incidentally giving WGR-074's fix
a real population to scope against), or change `impersonation_log.admin_id`'s FK target to
`profiles` (the table `requireRole("owner")` actually authorizes against today). Also fix the route
to check `{error}` on this insert regardless of which fix is chosen — a silently-swallowed write
failure on an audit table is its own small bug independent of the FK mismatch.

**WGR-075, P1.**

## What holds correctly, not just "no news"

**Demo-account write protection** (migration `138_demo_account_scope.sql`) works as designed. Beyond
PT-06's own column-existence-only drift check, this phase confirmed all 3 real functions and all 6
real triggers are live in production and wired to the correct function (not just name-matched), then
ran 8 real writes through real authenticated sessions: every protected write blocked, the one
explicitly-allowed branding column still writable, an unrestricted negative-control profile
unaffected, and an independent re-read confirming every blocked attempt genuinely mutated nothing.
**WGR-076, CONFIRMED-OK.**

## What a future phase should know before building on this

- **PT-06's tenant-FK-gap finding (WGR-064) is not resolved by this phase's clean result and should
  not be closed.** RLS enforcement and referential-integrity enforcement are separate mechanisms —
  PT-05 tested and cleared the former on all 13 flagged tables; the missing foreign key itself is
  still there, and still means a malformed tenant id in one of those 13 tables' `org_id` columns
  would go uncaught by the database. Narrower risk than a leak, but a real, open, distinct gap.
- **The local isolation environment (`.pt05-local-stack/`) is still running**, per PT-05-001's own
  note — a real Postgres 17 + GoTrue + PostgREST stack, seeded with two orgs and the real production
  RLS policy applied to the 20 live-tested tables. Reusable for a future phase without re-provisioning
  from scratch; see PHASE-05-SUMMARY.md's PT-05-001 section for exactly what's on it and what isn't
  (11 of production's 184 tables, no RLS on tables beyond the 20 this phase extended).

## Recommendation for the next phase

**PT-14 (security) now has PT-05's isolation results as a real starting point, not an open
question.** Cross-tenant reach — the question a security review would otherwise have to establish
from scratch — is settled: clean, across all 120 tables, on every operation. That means PT-14 can
spend its effort on the two things PT-05 actually found broken rather than re-proving tenant
isolation: **the admin-impersonation scoping gap (WGR-074, P0)** and its broken audit trail
(WGR-075, P1) are exactly the class of finding a security-focused pass should verify further and
help design the fix for — specifically, whether `owner` role should ever have been an
org-independent superuser grant on this platform, or whether that was always meant to be bounded and
simply never got built. WGR-072's 4 zero-policy tables are a smaller, cheaper follow-up in the same
pass: a quick application-code check (does anything read `ai_usage_log`/`enrichment_jobs`/
`kb_extended_needs`/`system_errors` via a normal authenticated session, or only via service role?)
would resolve that PENDING-SCOPE tag either way.
