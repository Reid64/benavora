# PT-10 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how every count was produced, see `PHASE-10-SUMMARY.md` in this same
directory. This doc is the short version: does the app fail *safely* when something goes wrong on
its own — bad input, a slow/dead database, a worker that dies mid-task, a garbage response from a
government API — and what's the single most important thing to fix.

## The question you actually care about: does the app fail safely?

**Mostly yes, in the way that matters most — nothing this phase threw at it produced a blank page, a
raw crash screen, or a corrupted/duplicated database row. But "doesn't blank the screen" turned out
to be a lower bar than "actually handles the failure well," and this phase found 21 real problems
across both passes — one of them a genuinely permanent stuck state.**

### The one to fix first: a killed worker leaves an application silently stranded forever

We killed a real worker process at the exact moment it would crash in production — right after it
claimed a job, right before it finished. The job row is left stuck at "processing" forever. Nothing
automatically notices. Nothing automatically retries it. And the one admin button that exists for
exactly this situation ("Clear Stuck Jobs" on `/admin/system`) doesn't even look at this table — it
only clears a different kind of stuck job. If this happens for real (a deploy restart, an
out-of-memory kill, a host getting evicted mid-job — all things that genuinely happen to
long-running processes), a real grant application silently never gets submitted, and nobody — not
the org, not an admin, not a log anyone's watching — is told it failed. It just sits there. Someone
has to know to go look directly in the database to even find it. **WGR-125, P1.**

### The second one: a slow database is worse than a dead one

We tested two different kinds of database trouble: fully unreachable, and just slow (still working,
just taking 15 seconds to answer). The fully-unreachable case actually degrades fine — the app
notices quickly and cleanly bounces the user to the login page, no crash, no hang. But the
*slow*-database case is worse: two real pages (the dashboard and the notifications API) just hang.
Not for a few seconds — we bounded our test at 30 seconds and they hit that ceiling with literally no
response at all. Nowhere in this codebase is there a timeout on a database call — not on the
connection, not on the query, not on the page render. If Supabase ever gets slow instead of fully
down (a far more common real-world failure mode than a clean outage), users just see a spinner
forever with no way to know anything's wrong. **WGR-124, P1.**

### Malformed input crashes 8 real routes with a raw HTTP 500 — and one leaks a database error message

We sent deliberately broken input (wrong data types, oversized strings, garbage dates, SQLi-shaped
strings) at 18 real routes. 13 of 72 attempts crashed with a plain 500 instead of a clean "here's
what's wrong with your request" response — the common pattern is a field that's checked for "is it
present" but never checked for "is it the right shape" before it hits a database column that
requires a very specific shape. One of these is worse than the rest: sending a non-numeric value to a
budget field on `/api/knowledge-base` returns the actual raw PostgreSQL error text back to whoever
sent the request — not app content, the database engine's own internal error message. That's a real
information-disclosure smell on top of the crash itself. **WGR-121, P2.**

### The login-redirect problem shows up here too — a third time now

We already knew (from the security audit, PT-14) that this app's login-redirect logic intercepts
*every* request without a browser session — including Stripe, email delivery, and the app's own
scheduled cron jobs — before those requests' own security checks ever get a chance to run. This phase
found the same thing again, a third independent way: sending a request to the notifications endpoint
with a valid cron secret (not a cookie, a real secret token) still gets redirected to the login page
instead of ever reaching the code that would check that secret. If a real automated system calls this
endpoint the way it's designed to be called, it gets silently bounced. **WGR-122, P1** — same root
cause as the already-known `WGR-111`, just reproduced against a new route and a new kind of caller.

### Two government-API integrations crash on a bad response; three others don't

We fed garbage responses at the six real places this app talks to outside services for grant/funding
data. Two of them — the Grants.gov and SAM.gov search clients — throw an unhandled exception if the
response comes back malformed, because a helper function assumes every item in the response array is
well-formed and never checks. Grants.gov is contained (a bad response only breaks that one org's sync
for that run, not the whole job); SAM.gov isn't contained at all — a bad response there crashes the
whole request and the caller gets a generic framework error page instead of anything useful.
**WGR-126/WGR-127, P2.** The other three integrations we tested — the ProPublica financial-data
client, the IRS 990 XML parser (which we fed genuinely nasty garbage: truncated tags, raw binary, an
HTML error page pretending to be XML), and the California state-portal feed parser — all handled
their own malformed input cleanly. Good, and worth saying plainly rather than only reporting the bad
news.

## What actually held up, stated plainly (not everything in this phase was a finding)

- **Zero blank/white screens anywhere**, across every single test in both passes. Checked explicitly
  on every case, not assumed.
- **Zero raw framework crash pages** reached a real response — even the routes that returned a 500
  did so as a clean JSON/HTTP error, not an unhandled server exception bubbling to the client.
- **Zero data corruption.** The one scenario that could have left a database row half-written or
  duplicated (the killed-worker test) was checked field-by-field afterward — the row is stuck, but
  it's intact, not garbled.
- **A full database outage degrades cleanly** — the app correctly bounces to the login page instead
  of crashing, even though nothing in the code explicitly plans for this; it's a side effect of how
  the underlying database library handles a connection failure, which is worth knowing (see the "one
  latent risk" note below) but the outcome today is genuinely fine.
- **Three of five third-party integration parsers handle garbage input correctly on their own.**

## One latent risk worth knowing about, even though nothing broke because of it

This app has **zero error-boundary pages configured anywhere** — no custom error page for the whole
app, none for the dashboard section, nothing. The reason a full database outage didn't crash the app
in our test is that the specific library function involved (`getUser()`) happens to swallow that
particular failure internally instead of throwing. If some *other* part of a page's rendering ever
throws for a different reason, there's nothing in this codebase configured to catch it gracefully —
the user would see whatever Next.js's own default behavior is for an uncaught error, not a
designed-for page. We didn't find a live case of this happening; we're flagging that the safety net
that would catch one doesn't currently exist.

## Priority order, if only fixing one thing today

1. **WGR-125** — a killed worker permanently strands a real grant application with zero visibility.
   This is the only finding in this phase involving real, permanent, silent business impact — fix
   this first. (Minimum viable fix: a stale-claim timeout in the queue's claim logic, or extend the
   existing "Clear Stuck Jobs" admin action to also cover this table.)
2. **WGR-124** — add a timeout to every Supabase call path (connection-level or query-level). A slow
   database should fail fast and visibly, not hang forever with no way to know anything's wrong.
3. **WGR-121** — the 8 routes that 500 on malformed input, especially the one leaking a raw
   PostgreSQL error message (`/api/knowledge-base`). Validate/coerce field shapes before they hit a
   typed database column.
4. **WGR-122** — same middleware fix already recommended for `WGR-111` (exempt cron/webhook-style
   routes from the login-redirect), now confirmed to affect this route's real caller too.
5. **WGR-126/WGR-127** — add a null guard in the shared response-mapping helper both Grants.gov and
   SAM.gov clients use; wrap SAM.gov's route body in a try/catch the way Grants.gov's cron route
   already does for its own call site.
6. **Not urgent, but cheap** — add at least one top-level error boundary (`app/error.tsx`) so a
   future, different kind of crash has somewhere to land instead of nothing.
