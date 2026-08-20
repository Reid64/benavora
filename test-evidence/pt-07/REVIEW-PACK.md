# PT-07 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how every count was produced, see `PHASE-07-SUMMARY.md` in this same
directory. This doc is the short version: of everything the app depends on outside its own
codebase, what's actually proven live right now versus what's only assumed to work, what's the
single most important thing to fix, and what's left after this phase.

## The question you actually care about: which of our third-party dependencies can we trust right now?

**The platform's own infrastructure: yes, trust it. Its grant-discovery data sources: mostly no.
Its comms/billing providers: there's nothing to trust or distrust yet — they're not configured.**

### Genuinely live — a real network round-trip succeeded this session, not inferred from a code read

- **Supabase database** — a real query ran, and a real write was rejected by Postgres itself
  (not just by app-level logic) to prove the read-only guarantee is real.
- **Supabase Auth** — a real login session was issued and independently verified against a second,
  fresh client.
- **Supabase Storage** — every bucket the app's code expects exists, exactly, no more, no less.
- **The Railway worker** — a real job was queued, picked up, and completed by the actual deployed
  worker process in 25.6 seconds, with a heartbeat confirming it's alive right now, not stale.
- **USASpending.gov** and **ProPublica Nonprofit Explorer** — both real APIs called for real, both
  returned exactly the fields the app's parsers read.
- **The ScraperAPI proxy gateway itself** — confirmed real and live (it rejected a bad key with a
  real, specific error), though nothing in this environment is actually configured to route through
  it.
- **Stripe's webhook signature-verification code** — exercised offline against the real Stripe SDK
  with a valid signature, a tampered payload, and a wrong secret; all three behaved correctly. The
  code is trustworthy even though billing itself isn't turned on.

### Confirmed broken — a real round-trip happened and it failed, silently, in production, right now

- **Grants.gov** — the URL the app calls doesn't exist anymore (403). Even switching to the real,
  current endpoint wouldn't be enough — the response shape has also changed underneath the app's
  parser.
- **SAM.gov, in four separate ways** — the main search endpoint 400s on every call because two
  required parameters are missing; once fixed, the results carry a fetch-URL instead of real
  description text and never carry an amount at all; a second, independent adapter for
  entity-by-NAICS search 400s on every call; a third, independent adapter for award-notice lookups
  silently returns zero results because it reads a field one level too shallow.
- **Supabase Realtime** — the publication that's supposed to push live updates has nothing plugged
  into it. Seven different live-status widgets across AutoApply and the Command Center are all
  quietly falling back to their 60-second poll instead of updating instantly, and have been since at
  least 2026-08-07, when this exact root cause was first found and never fixed.

**Every one of these failures is invisible in production today.** None of them crash, none of them
raise an alert, none of them show up on any dashboard. The daily Grants.gov cron and every
SAM.gov-backed research path have been quietly finding nothing, for an unknown amount of time,
looking exactly like a healthy job that just happens to have no new results.

### Not tested because there's nothing to test — an honest gap, not an assumption

Resend, Stripe (the billing/checkout side, not the webhook code above), and Google Calendar are all
**confirmed unconfigured in every single environment** — not in local dev only, in every Vercel
environment too, checked live. Each was dry-run with its credential deliberately absent (matching
the real production state) and each degraded gracefully with a clear error, no crash. This is the
difference between "we didn't check" and "we checked, and there's genuinely nothing live to check
against" — recorded as `PENDING-SCOPE`, not silently skipped.

## The one to fix first

**Grants.gov and SAM.gov, together (WGR-138 through WGR-143).** These are the platform's primary
federal funding-opportunity sources, and every real path into them — the main search, both
donor-discovery SAM.gov adapters — is broken today, silently. This isn't a partial degradation; it's
a total, invisible failure of the core "go find new grant opportunities" pipeline for two of its
biggest sources. Nothing else in this phase comes close in blast radius: the Realtime gap only costs
instant-vs-60-second UX, and the comms/billing gaps are honest absences waiting on a product
decision, not silent failures of something that's supposed to be running today.

## Priority order, if only fixing one thing today

1. **Grants.gov + SAM.gov (WGR-138/139/142/143)** — fix the URL/params/field-mapping issues found
   this session; each one is a small, specific, already-diagnosed change (a URL, two query params,
   two field paths), not a redesign. Add a loud failure signal (not just a silent empty array) so a
   future break like this doesn't go unnoticed for however long these two already have.
2. **Realtime (WGR-148)** — apply the one-line `ALTER PUBLICATION` fix that's been sitting
   documented and unapplied since 2026-08-07. Cheap, already scoped, already known.
3. **SAM.gov data-quality (WGR-140/141)** and **the IRS BMF header-row drift (WGR-144)** — lower
   urgency, real but not blocking.
4. **Resend/Stripe/Google Calendar (WGR-146/147)** — not a code fix, a product decision: turn these
   on when the business is ready to send email, take payment, or offer calendar sync. Nothing here
   is broken; it's just off.

## Next-phase note

**This closes the last open phase of the audit program.** PT-00 through PT-14 (PT-12 was never
assigned a phase in this numbering scheme) are now all complete — PT-05, PT-06, PT-08, PT-09, PT-10,
PT-11, PT-13, and PT-14 were completed earlier in this same session's chronology, PT-03 and PT-04
immediately before this phase, and PT-07 closes it out. `WIRING_GAP_REGISTER.md` runs `WGR-001`
through `WGR-148`, unbroken, spanning build/infra, config, frontend, API, business logic, data
integrity, tenant isolation, agent orchestration, error handling, observability, security, and now
third-party integrations. A future session picking this back up should treat the register as the
canonical, standing punch list — not re-derive it — and prioritize by severity across all 148 rows
rather than by which phase a finding happened to be found in. Two things this phase specifically
flagged as worth a second look rather than treated as settled: whether every one of Realtime's 7
silently-affected consumers genuinely has a working poll fallback (only one was directly confirmed),
and whether the Grants.gov/SAM.gov breakage has already caused a measurable, dated gap in real
`opportunities` discovery volume that a follow-up data audit could quantify.
