# PT-14 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how every count was produced, see `PHASE-14-SUMMARY.md` in this same
directory. This doc is the short version: what an attacker (or a broken integration) can actually do
today, and what to fix first.

## The question you actually care about: can someone inject something into this app, or break something else's ability to talk to it?

**Yes to the first, in three real, live-reproduced ways — all server-side outbound requests, none of
them classical SQL injection.** And investigating the fourth vector (CSRF) surfaced a real, separate
availability problem that may be actively breaking billing and email webhooks and the platform's own
scheduled automation right now.

### 1. Two live-confirmed SSRF holes, one high-confidence third

The platform built a real SSRF defense (`safeFetch()`) for exactly one feature (Custom API
Connectors). It is not used anywhere else. Two other real, server-side, user-URL-taking code paths
fetch with zero protection, and this session proved it by running the *exact* vulnerable code
(copied verbatim, not reimplemented) against a real local listener and watching it succeed where
`safeFetch()` blocks the identical target:

- **`POST /api/intelligence/ingest`** (writer role — the lowest privileged authenticated role) fetches
  any URL you give it and **saves the response content** into the Intelligence Library, where any
  viewer can read it later. This is full SSRF-with-exfiltration: point it at cloud metadata or an
  internal admin API and read the answer back through the app's own UI.
- **AutoApply webhook notifications** (`WebhookNotifier.notify()`) POST to whatever URL an org admin
  configures, on every real AutoApply event, forever, with no validation beyond "is this a
  well-formed URL." An admin — or a compromised admin session — can point it at an internal service
  and the platform will keep hitting it.
- **AutoApply's own submission pipeline** navigates a real headless browser to a funder's
  `giving_portal_url` — a field any writer/admin can set — with the same zero protection. Not
  live-reproduced this session (full Playwright launch was out of scope for this pass), but the code
  has no guard at all, and this one is worse in kind than the other two: it's a full browser, not
  just a fetch, so screenshots and page content are both fair game once it reaches wherever the URL
  points.

Fix: route all three through `safeFetch()` (or an equivalent guard for the browser-navigation case).
This is the single highest-value fix in this whole phase.

### 2. One real, narrow SQL/filter-injection hole

`GET /api/email/threads?search=` builds its filter by string-pasting your search term straight into
a PostgREST query, with none of the comma/paren stripping the two comparable search endpoints in
this codebase already do. Proven live: a crafted `search` value made the route return every email
thread in the org, not just ones matching the search term. It can't cross the org boundary (that's a
separate, already-independently-verified-safe filter), so the damage is "see more of your own org's
data than intended, or crash the request" — not a cross-tenant leak. Still worth a one-line fix
(strip `,()%` before interpolating, matching the pattern already used two other places in this same
codebase).

### 3. Zero exploitable XSS, one already-known unfixed adjacent gap

Nothing new and dangerous here. React's default escaping holds everywhere that matters; the one real
raw-HTML-building sink in the app (the unsubscribe page) correctly escapes its input. The one
lingering issue — transactional email templates building raw HTML with no escaping — was already
found and documented five weeks ago (`SECURITY_TEST_2026-08-15.md`) and is still unfixed; this pass
just re-confirmed it and gave it a permanent register row (WGR-113) so it stops falling through the
cracks between audit passes.

### 4. Zero forgeable CSRF holes — but a real availability bug hiding behind that same "protection"

Every state-changing route this session tried to forge (no session cookie, spoofed headers, unsigned
webhook payloads, missing cron secrets) got correctly rejected. Good news on its face. But *how* the
webhook and cron routes reject a forged request turned out to be the same blunt instrument used
everywhere else on the site: the login-redirect middleware, which requires a real user session for
literally every path except a short explicit allowlist. Stripe, Resend, and Vercel's own Cron
scheduler never carry a login session either — to this middleware, a real Stripe webhook and a forged
one look identical, and both get redirected to `/login` before the route's own signature/secret check
ever runs. If that holds for real traffic the same way it held for this session's test traffic (it
should — middleware can't tell the difference), **real billing events, real email delivery tracking,
and all 5 of the platform's own scheduled cron jobs may not be reaching their handlers at all right
now.** This needs a human to check the Stripe/Resend/Vercel dashboards for actual delivery failures —
this session couldn't reach those. If confirmed, the fix is a one-line addition to
`middleware.ts`'s path allowlist (add `/api/webhooks/*`, `/api/admin/webhooks/*`, `/api/cron/*` —
each already has its own real signature/secret check that doesn't need a session on top of it).

### 5. The "is our RLS actually fixed" question, answered for real: yes

A separate document, `MASTER_BACKLOG.md` (2026-07-30), had flagged 8 tables and 5 storage buckets as
readable by anyone with no login at all — and a later session claimed they were all fixed. Nobody had
gone back and actually checked both claims against each other with the real anon key. This pass did,
against all 184 tables in the current schema and all 7 live buckets, not just the ones either
document happened to name. **Good news, checked, not assumed: zero of them leak anything today.**
Every one of the 8 disputed tables and 5 disputed buckets is genuinely blocked live. One new bucket
(`org-branding`) turned up that neither document knew about — same "any authenticated user can
overwrite any object" write pattern as the already-flagged `nofa-pdfs`, plausibly intentional, worth
a one-line confirmation. And digging through the grant tables to answer the read question surfaced a
real, if currently harmless, gap: 107 tables and all 47 database functions still have their default
write/execute permissions granted to the anonymous role and never revoked — nothing can exploit it
today because every actual write rule correctly checks who's logged in first, but it's one policy bug
away from mattering, and the fix (revoke the stale grant) is cheap. `WGR-115` through `WGR-119`.

## Priority order, if only fixing one thing today

1. **WGR-111** — check whether Stripe/Resend/Vercel Cron are actually failing in production right
   now. If yes, this is silently breaking billing, email tracking, and nightly automation — worse
   than any of the security findings below it.
2. **WGR-108/109/110** — route the three unguarded fetch/navigation paths through `safeFetch()` (or
   equivalent for the browser case).
3. **WGR-112** — strip `,()%` from the `search` param the same way the other two search endpoints do.
4. **WGR-113** — add an `escapeHtml()` helper to the email template layer (already known, already
   overdue).
5. **WGR-117** — get Reid's one-line confirmation that `org-branding`'s unscoped-authenticated write
   is intentional (same open question as the already-known `nofa-pdfs` case).
6. **WGR-118/119** — revoke the stale default `anon` write/execute grants on the 107 tables and 47
   functions that still have them. Not urgent (nothing exploits it today) but cheap and closes a real
   defense-in-depth gap.
