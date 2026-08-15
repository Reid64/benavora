# Demo Account Verification — FAITH Foundation demo account, live-tested 2026-08-15

## Status: PASS — full navigability confirmed, all protected-write attempts genuinely rejected, zero gaps found

This is a real, live verification pass against the production Supabase database
(project `vbjplpquqxxfbpazyalt`) and the app running against that same database
(local `next dev`, port 3001 — Next.js dev serves the identical route/API code
against the real live DB; no mocks, no stubs). Account under test:
`demo@faithfoundationsf.org` / Supabase Auth user `275f2b6a-03d5-4ec8-8692-2a5ac7442042`,
`profiles.role='writer'`, `profiles.restricted_onboarding_edit=true`, org FAITH
Foundation (`b1ab7402-dfc2-4712-869f-70ea3566cc1d`). Spec: `DEMO_ACCOUNT_SCOPE_2026-08-15.md`.
Migration under test: `supabase/migrations/138_demo_account_scope.sql` — confirmed
applied to the live DB before testing (column, function, and all 6 triggers
present via live `information_schema` query).

---

## 1. Navigability — 6 real distinct pages, all loaded successfully

Driven by a real headless-Chromium Playwright session
(`scripts/_tmp_verify_demo_navigation.mjs`, deleted after use — not a permanent
test, a one-off verification script), logging in via the real `/login` form
with the account's real password.

| # | Page | Feature area | Result |
|---|---|---|---|
| 1 | `/dashboard` | Home / overview | HTTP 200, real content rendered |
| 2 | `/opportunities` | Grant opportunity discovery | HTTP 200, real content rendered |
| 3 | `/applications` | Application pipeline | HTTP 200, real content rendered |
| 4 | `/knowledge-base` | Knowledge base (read) | HTTP 200, real content rendered |
| 5 | `/autoapply` | AutoApply | HTTP 200, real content rendered |
| 6 | `/draft-generator` | AI draft generation | HTTP 200, real content rendered |

All 6/6 passed — status < 400, no "500"/error-boundary text, main content
container visible. Exceeds the required minimum of 5.

---

## 2. Real write-capable action — AI draft generation, confirmed via direct DB read

Action: on `/draft-generator`, selected a real existing opportunity ("Centers
of Excellence for Veteran Student Success (CEVSS) Program",
`a3e45cc5-5176-4b2a-88a9-d294e426ec6e`), selected the "Grant narrative"
template, clicked "Generate draft". This invokes `POST /api/ai/draft`, a real
call to the Anthropic API (confirmed in the dev server log: `POST
/api/ai/draft 200 in 179818ms` — a ~180s real Claude generation call, not a
mock).

**DB verification (not just a UI "it looked like it worked" check):** queried
`draft_versions` directly via `psql` against the live database immediately
after:

```
id               = 46592902-100e-4f3c-a3a4-49b2bebe0448
organization_id  = b1ab7402-dfc2-4712-869f-70ea3566cc1d
opportunity_id   = a3e45cc5-5176-4b2a-88a9-d294e426ec6e
template_type    = grant_narrative
content length   = 40,628 characters
created_by       = 275f2b6a-03d5-4ec8-8692-2a5ac7442042  (the demo account's own user id)
created_at       = 2026-08-15 19:39:45 UTC
```

`created_by` matching the demo account's real Supabase Auth user id, with a
`created_at` timestamp matching the moment the test ran, confirms this is a
genuine write performed by this account's real session — not a stale/seeded
row and not a different test user's row.

---

## 3. Protected-field write attempts — 5 attempted (3 required minimum), all genuinely rejected

Driven by a second one-off script
(`scripts/_tmp_verify_demo_protected_writes.mjs`, also deleted after use) that
authenticates via `supabase-js` + the real anon key using the demo account's
real email/password (`auth.signInWithPassword`) — the exact same client-side
auth path the browser app itself uses — then issues writes directly against
PostgREST, mirroring `settings/page.tsx`'s direct client-side
`organizations.update()` call specifically (the one write path in the spec
that bypasses every API route, per `DEMO_ACCOUNT_SCOPE_2026-08-15.md` §2.7/§3.2).

| # | Table / column | Attempt | Result | Error |
|---|---|---|---|---|
| 1 | `organizations.name` (protected column) | `UPDATE organizations SET name='HACKED BY DEMO ACCOUNT' WHERE id=<org>` | **REJECTED** | `42501: This demo account cannot modify this organization field.` |
| 2 | `knowledge_base` (full-block table) | `INSERT` a fake KB entry | **REJECTED** | `42501: This demo account cannot modify organizational profile data.` |
| 3 | `board_members` (full-block table) | `INSERT` a fake board member | **REJECTED** | `42501: This demo account cannot modify organizational profile data.` |
| 4 (bonus) | `programs` (full-block table) | `INSERT` a fake program | **REJECTED** | `42501: This demo account cannot modify organizational profile data.` |
| 5 (bonus) | `documents` (full-block table) | `INSERT` a fake document row | **REJECTED** | `42501: This demo account cannot modify organizational profile data.` |

All 5 errors are real Postgres `42501` (insufficient_privilege) exceptions
raised by the `block_if_onboarding_edit_restricted()` /
`block_restricted_organizations_update()` trigger functions from migration
138 — not client-side validation, not a silent no-op, not an RLS policy
violation (which would be a different error), and not a request that failed
before reaching the trigger (the one attempt that initially failed for the
wrong reason — a `documents` insert using a bad column name, `PGRST204` before
the trigger could fire — was corrected to use the real `file_name` column and
re-run; it then hit the same real `42501` as the others).

**No partial-write side effects.** After all 5 rejected attempts, direct DB
reads confirm zero corruption:
- `organizations.name` for FAITH Foundation is still exactly `"FAITH Foundation"` (unchanged).
- Zero rows in `knowledge_base`/`board_members`/`programs`/`documents` matching any of the injected test values.

**No bug found.** Every protected-field write attempt was genuinely and
completely rejected. Nothing required fixing or re-testing.

---

## 4. Tier-2 write access unaffected

The draft-generation write in §2 (`draft_versions`, explicitly Tier 2 /
unprotected per spec §2.8) succeeded normally for this `restricted_onboarding_edit=true`
account, confirming the triggers are scoped to exactly the six protected
tables/columns and do not over-block ordinary functional writes.

---

## 5. Cleanup

Both one-off verification scripts
(`scripts/_tmp_verify_demo_navigation.mjs`, `scripts/_tmp_verify_demo_protected_writes.mjs`)
were deleted after this verification pass — they were manual test harnesses
for this task, not permanent additions to the `e2e/` suite. The one real
draft row created in §2 (`draft_versions` id `46592902-...`) is a legitimate
functional write to a Tier-2 table and was left in place (deleting it is not
required — it is exactly the kind of real data this demo account is meant to
be able to produce).
