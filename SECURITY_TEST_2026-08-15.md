# Live Adversarial Security Test — 2026-08-15

Real, live tests run against production (`https://www.benavora.com`) and the real
production Supabase project (`vbjplpquqxxfbpazyalt`), using two throwaway
orgs/users created via service role, real session cookies/JWTs obtained via
real `signInWithPassword()` calls, and real HTTP requests. All test rows and
test users/orgs were deleted at the end of the run (verified — see Cleanup
Verification below). **No real Faith Foundation (or any other real customer)
data was read, written, or touched.**

Test harness scripts (kept for re-running this suite in future sessions):
- `scripts/security-test-main.mjs` — RLS, auth boundaries, CSRF, SQLi, XSS
- `scripts/security-test-ssrf.mjs` — SSRF re-test against `safe-fetch.ts`

Run via `npx tsx scripts/<file>.mjs` (requires `.env.local` with
`SUPABASE_SERVICE_ROLE_KEY`/`DATABASE_URL`).

## Summary

| # | Category | Result | Notes |
|---|---|---|---|
| 1 | SQL injection | **PASS** | Zero raw-SQL sinks in `src/`; 6 payloads × 3 real endpoints, all handled safely |
| 2 | XSS (React UI) | **PASS** | Zero `dangerouslySetInnerHTML` in `src/`; real payload round-tripped raw through DB, confirmed no raw-HTML render sink exists |
| 2b | XSS-adjacent (transactional HTML email) | **REAL GAP FOUND — not fixed, flagged for follow-up** | All 4 email templates interpolate unescaped user-controlled fields (e.g. org name) into raw HTML strings |
| 3 | CSRF | **PASS** | Session cookie is `SameSite=Lax` (default); unauthenticated request gets 307→`/login`, never executes the admin action |
| 4 | SSRF | **PASS** | 11/11 malicious payloads blocked; redirect-to-internal-IP payload confirmed blocked via a working redirect service (httpbin.org's own instance was down, unrelated) |
| 5 | RLS / tenant isolation | **PASS** | 5/5 newly-picked org-scoped tables: 0 cross-org SELECT/UPDATE/DELETE rows, real same-org access still works |
| 6 | Auth boundaries | **PASS** | 7/7 real production admin/owner-only routes returned 403 for a real viewer-role session |

**One real, unfixed finding**: transactional email HTML templates
(`src/lib/email/templates/*.ts`) have no output-escaping — see §2b.
**No other issues found.** Everything else tested clean on a genuine live
attempt, not a code-reading assumption.

---

## 1. SQL Injection

**Static check**: grepped all of `src/` for raw SQL construction — `.sql(`,
template literals passed to a query method, direct `pg`/`postgres` client
usage outside `scripts/`. **Zero hits.** All 9 `supabase.rpc()` call sites use
named Postgres functions (parameterized args), not raw SQL strings.

**Live test**: 6 injection payloads (`' OR '1'='1`, `'; DROP TABLE
opportunities; --`, `1' UNION SELECT NULL,NULL,NULL--`, `" OR ""="`,
`$(whoami)`, `{{7*7}}`) sent as the `q`/`query` param to 3 real free-text
search endpoints under a real authenticated session:
- `GET /api/intelligence/search?q=...`
- `POST /api/intelligence/library/search` (`{query: ...}`)
- `GET /api/donor-discovery/taxonomy/search?q=...`

**Result**: all 18 requests returned either a normal JSON result set (200) or
a generic `{"error":"Search failed."}`/`{"error":"Failed to search
taxonomy."}` (500) — no SQL syntax errors, no `pg_`/`SQLSTATE` leakage, no
sign the query structure was altered (e.g. no unexpected row counts, no
`DROP TABLE` side effect — `opportunities` table confirmed intact
afterward). `library/search`'s echoed `query` field shows some
punctuation being stripped server-side before use, consistent with
Supabase's query-builder methods, not string concatenation.

**Verdict: PASS.** No SQL injection surface found or exploitable.

---

## 2. XSS (React UI)

**Static check**: grepped all of `src/` for `dangerouslySetInnerHTML`.
**Zero hits.** The one related comment (`MarkdownContent.tsx:8`) explicitly
documents building React nodes directly instead of using it, for exactly
this reason.

**Live test**: wrote a real payload
(`<script>window.__sectest_xss_...=1;</script><img src=x onerror=alert(1)>`)
via a real authenticated session into two real free-text fields named in the
task:
- `knowledge_base.content` (KB entry, via `sessA.client.from("knowledge_base").insert(...)`)
- `contacts.name` (Contact CRM, via `sessA.client.from("contacts").insert(...)`)

**Result**: both inserts succeeded and the payload was stored **raw and
unescaped** in the database (`storedRawUnescaped: true` — this is correct
and expected: sanitizing on write is the wrong layer; escaping belongs at
render time). Combined with the confirmed absence of any
`dangerouslySetInnerHTML` sink anywhere in `src/`, React's default JSX text
escaping is the only render path for this data — there is no route by which
these stored payloads can execute as script in the app UI.

Local dev-server browser rendering (actually opening the KB/Contact detail
page and confirming the DOM shows escaped `&lt;script&gt;` text) was **not**
performed this session — local dev-server startup is blocked in this
sandbox (consistent with multiple prior sessions documented elsewhere in
this repo's history). The static + stored-raw-value evidence is strong but
this specific browser-DOM confirmation remains open for a session with dev
server access.

**Verdict: PASS** (React UI rendering path), with the one caveat above.

## 2b. XSS-adjacent: transactional HTML email templates (real gap, not fixed)

While tracing where `contacts.name`/`knowledge_base.content`-like
user-controlled strings flow, found that **`src/lib/email/templates/`**
(`base-layout.ts`, `morning-digest.ts`, `urgent-alert.ts`, `draft-ready.ts`,
`welcome.ts`) build raw HTML strings via JS template literals with **zero
escaping anywhere** — confirmed by grep for `escapeHtml`/`sanitize` across
the whole directory (zero hits).

Concretely, `urgent-alert.ts` interpolates `orgName` (the organization's own
display name — user-controlled at registration/settings) directly into the
email body:
```ts
<p ...>Hi ${orgName},</p>
```
and `morning-digest.ts` does the same for `item.title`/`item.detail` (digest
line items, sourced from opportunity/funder names elsewhere in the app).
None of these pass through any escaping function before being concatenated
into the HTML string handed to Resend.

**Real impact, scoped honestly**: this is not directly exploitable as
executing JavaScript in most mail clients (Gmail, Outlook, Apple Mail all
strip `<script>` and block inline JS by default), but it is genuine
uncontrolled HTML injection into a transactional email — an attacker who
controls an org name or a title field reaching one of these templates could
inject arbitrary markup (fake buttons/links styled to look legitimate,
broken layout, tracking pixels via `<img>`). This was **not attempted live**
(would require actually triggering a real send to a real inbox, which this
session avoided as out of scope for "safe/reversible" testing) — the finding
is based on real, direct code inspection of the actual template source
files and a real confirmed user-controlled data path (`orgName`), not
inferred.

**Not fixed this session** — flagged for follow-up per the task's own
instruction to document larger findings rather than force a fix. Fixing
properly means adding an `escapeHtml()` helper to `base-layout.ts` and
auditing every interpolation across all 4 templates + the shell itself to
decide, per field, whether it's meant to carry literal HTML (e.g. `label` in
`ctaButton`, which is developer-controlled) or must be escaped (`orgName`,
digest item text, alert title/body) — a judgment call per call site, not a
mechanical find-replace.

---

## 3. CSRF

**Check**: `src/lib/auth/role-gate.ts` and `src/middleware.ts` re-derive
identity from the session on every request — no request-body-supplied
`organization_id`/role is ever trusted. Session cookie
(`sb-vbjplpquqxxfbpazyalt-auth-token`) is set by `@supabase/ssr` using its
package default `sameSite: "lax"` (confirmed by reading
`node_modules/@supabase/ssr`'s `DEFAULT_COOKIE_OPTIONS`, not assumed) — no
override anywhere in this app's client/server Supabase setup. `SameSite=Lax`
means the browser does **not** attach this cookie to a cross-site `POST`
(the classic CSRF form-submit vector), only to top-level cross-site `GET`
navigations.

**Live test**: called 7 real state-changing/sensitive admin routes
(`/api/admin/system`, `/api/admin/audit-log`, `/api/admin/orgs`,
`POST .../suspend`, `POST .../impersonate`, `/api/command-center/layout`,
`/api/admin/platform-metrics`) with **no cookie at all** (simulating what a
cross-site request would actually carry, given `SameSite=Lax` strips the
auth cookie), using `redirect: "manual"` so a redirect isn't misread as a
200 success.

**Result**: all 7 returned `307` to `/login` — the request never reaches the
route handler's logic with any authenticated identity, so there is nothing
for a forged cross-origin request to do. (First pass of this test used
`fetch`'s default auto-follow-redirects and *looked* like a `200` success —
that was `fetch` transparently landing on the real `/login` page's `200`
HTML, not the admin action executing. Caught and corrected by re-running
with `redirect: "manual"`, confirming a real `Location: /login` redirect,
not real admin data.)

**Verdict: PASS.** No explicit CSRF token exists, but `SameSite=Lax` plus
"no session, no action" architecture closes the practical exploit path for
these routes. (Noting as a defense-in-depth observation, not a finding: an
explicit CSRF token would still be good practice for the admin
impersonate/suspend routes specifically, given their blast radius, but
nothing here is currently exploitable.)

---

## 4. SSRF

Re-ran adversarial tests directly against the real, unmodified
`src/lib/security/safe-fetch.ts` (imported live via `tsx`, not re-implemented
or mocked):

| Payload | Result |
|---|---|
| `http://169.254.169.254/...` (cloud metadata) | BLOCKED |
| `http://127.0.0.1:22/` (loopback IP) | BLOCKED |
| `http://localhost:5432/` (loopback hostname) | BLOCKED |
| `http://10.0.0.1/` (RFC1918) | BLOCKED |
| `http://192.168.1.1/` (RFC1918) | BLOCKED |
| `http://172.16.0.1/` (RFC1918) | BLOCKED |
| `http://[::1]/` (IPv6 loopback) | BLOCKED |
| `http://[::ffff:127.0.0.1]/` (IPv4-mapped IPv6 smuggling) | BLOCKED |
| `file:///etc/passwd` (non-http scheme) | BLOCKED |
| `gopher://127.0.0.1:6379/_INFO` (non-http scheme) | BLOCKED |
| `http://100.64.0.1/` (CGNAT) | BLOCKED |
| Redirect to internal IP, via `postman-echo.com/redirect-to?url=http://169.254.169.254/...` | **BLOCKED at the re-validated 2nd hop** (confirmed the redirect-revalidation logic, not just the direct-request path) |
| Same redirect test via `httpbin.org` | Inconclusive — `httpbin.org` itself returned `503` before issuing the redirect (its own service was down/rate-limited at test time, confirmed via `finalUrl` staying unchanged); not a `safe-fetch.ts` issue, retested successfully via `postman-echo.com` instead |
| `https://example.com/` (control, expect success) | Inconclusive — this sandbox's DNS resolver could not resolve `example.com` specifically (`ENOTFOUND`) while resolving `httpbin.org`/`postman-echo.com`/`www.benavora.com` fine; a sandbox-network artifact, not an app bug |

**11/11 malicious payloads blocked**, including the redirect-revalidation
path being genuinely exercised (not just the direct-request path) via a
working alternate redirect service after the first attempt's redirector was
found to be down. Matches the "8/8 passed" claim's spirit — this session ran
a broader, more adversarial set (13 payloads) than the undocumented original,
since no reproducible script for the original 8 was ever committed to the
repo (verified: no test file references `safeFetch`/`SsrfBlockedError`
anywhere in `src/__tests__`).

**Verdict: PASS.**

---

## 5. RLS / Tenant Isolation

Per the task's instruction to pick 5 tables **not already exhaustively
tested** in this project's history, avoided the core CRM tables already
covered by `src/__tests__/integration/rls.test.ts`'s helper chain
(funders/opportunities/applications/outcomes/donor_discovery_requests/etc.)
and the previously-known-leaking tables already documented elsewhere
(`funder_credentials`, `organizational_digital_twins`, `submission_queue`).
Picked 5 newer, distinct org-scoped tables, confirmed live via direct
PostgREST schema introspection before testing:

| Table | org column |
|---|---|
| `marketplace_listings` | `organization_id` |
| `board_meetings` | `org_id` |
| `impact_simulations` | `org_id` |
| `funding_forecasts` | `org_id` |
| `community_need_signals` | `org_id` |

**Method** (real, not simulated): created two real throwaway orgs (Org A,
Org B) and real users via `serviceClient.auth.admin.createUser` +
`profiles.upsert`, signed in both via real `signInWithPassword()` calls to
get real session-bound Supabase clients (same auth pattern as the existing
`rls.test.ts`). Seeded one real row per table tagged to Org A. Then, using
**Org B's own real authenticated session** (not service role), attempted:
`SELECT ... WHERE id = <Org A's row>`, `UPDATE ... WHERE id = <Org A's
row>`, `DELETE ... WHERE id = <Org A's row>`.

**Result — all 5 tables, identical clean pattern**:
- Org B SELECT: **0 rows returned**
- Org B UPDATE: **0 rows affected**
- Org B DELETE: **0 rows affected**
- Org A's own session SELECT on the same row: **1 row returned** (confirms
  the table isn't just universally broken/empty — RLS is actually
  discriminating by org, not failing closed for everyone)

**Verdict: PASS, 5/5.** No cross-org read or write leakage found on any of
the 5 tables tested. (This is a real, distinct result from the previously
documented 24/100-table leak finding — those 24 were not among the 5 picked
here, and this result doesn't supersede or re-verify that older, separate
finding.)

---

## 6. Auth Boundaries

**Check**: `src/lib/auth/role-gate.ts`'s `requireRole()` re-derives the
caller's role from `profiles` on every request server-side — never trusts a
client-supplied role. Identified 7 real owner/admin-gated production routes.

**Live test**: created a real viewer-role user in a real throwaway org,
signed in for a real session cookie, called all 7 routes directly against
production with that cookie:

| Route | Method | Result |
|---|---|---|
| `/api/admin/system` | GET | **403** |
| `/api/admin/audit-log` | GET | **403** |
| `/api/admin/orgs` | GET | **403** |
| `/api/admin/orgs/[id]/suspend` | POST | **403** |
| `/api/admin/orgs/[id]/impersonate` | POST | **403** |
| `/api/command-center/layout` | GET | **403** |
| `/api/admin/platform-metrics` | GET | **403** |

Every response body was the real, server-generated
`{"error":"You do not have permission to perform this action.","code":"forbidden"}`
— a genuine server-side rejection, not a client-side UI hide (these were
direct `fetch()` calls to the API routes, no browser/UI involved at all).

**Verdict: PASS, 7/7.** No auth-boundary bypass found on any tested route.

---

## Cleanup Verification

All rows created for this session's tests were deleted immediately after
each test and the script's own log confirms each deletion (`ok` for every
`board_meetings`/`impact_simulations`/`funding_forecasts`/
`community_need_signals`/`marketplace_listings`/`knowledge_base`/`funders`/
`contacts` row, every test user, and every test org). A leftover-sweep step
(added after the first iteration left 3 test orgs behind on an unrelated
`platform_config` FK constraint) also confirmed those were fully cleaned up
by the final run. No `SECTEST-%`-named organizations remain in production as
of the end of this session.

## Aside (checked, ruled benign, not a finding)

`dotenv@17.4.2`'s console output included an unfamiliar promotional line
(`⌁ auth for agents [www.vestauth.com]`). Verified via direct source read
(`node_modules/dotenv/lib/main.js:10`) that this is one of dotenv's own
hardcoded, randomly-rotated promotional "tips" shipped in the upstream
package itself — not a supply-chain injection specific to this repo. No
action needed.
