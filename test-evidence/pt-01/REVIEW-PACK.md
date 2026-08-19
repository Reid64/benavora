# PT-01 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how each was produced, see `PHASE-01-SUMMARY.md` in this same directory.
This doc is the short version: what wiring is confirmed solid, what's broken and how bad, and what
we recommend for the next phase.

## What PT-01 actually did

PT-00 established a baseline from HTTP status codes and a static string-comparison of `nav-items.ts`
against the build's route manifest. PT-01 went one layer deeper on every one of those claims: real
authenticated Playwright sessions that actually render the DOM, actually click every nav element, and
actually inspect every interactive element's handler binding — rather than trusting a status code or
a string match. Four checks, plus a fifth pass re-verifying five specific "already fixed" claims that
had no corresponding commit:

1. **Render pass** — navigated to all 146 real page routes, checked for an error-boundary signature,
   real content vs. an empty shell, and console errors.
2. **Nav resolution** — clicked all 72 real nav elements across 5 real nav surfaces (sidebar, admin,
   header tabs, header avatar menu, settings sub-nav) and confirmed each one actually navigates
   somewhere real.
3. **Element wiring** — enumerated and classified all 5,307 `<a>`/`<button>`/`[role="button"]`
   elements actually present in the rendered DOM across the 36 primary-nav pages plus 20 sub-pages,
   by inspecting each one's real handler binding (React fiber props, `onclick`, ancestor `<a href>`,
   ancestor `<form>`) — never by firing the element.
4. **Claimed-fixes re-verification** — a prior request described 5 specific items as already fixed
   with no matching commit anywhere in git history. Re-tested each from scratch against fresh live
   evidence, not trusted either way.

## What's confirmed solid

- **145 of 146 page routes render correctly** — real content, no error boundary, no blank shell.
- **All 72 real nav elements across all 5 nav surfaces resolve correctly** when actually clicked —
  zero 404s, zero error boundaries, zero blank renders, zero elements missing from the DOM. This is
  the live version of PT-00's static `deadNav: []` claim, and it holds up under real click-through —
  see the "PT-00 cross-check" section below for exactly what this does and doesn't confirm.
- **5,301 of 5,307 interactive elements (99.9%) are genuinely wired** — real click handlers, real
  hrefs, real form actions. This includes catching and fixing a false positive in our own classifier
  (a native `<form method="GET">` submit button on `/nonprofits` that our first pass wrongly flagged
  as broken because it has no JS `onSubmit` — the plain browser default is a real, correct action).
- **All 5 previously-unverifiable "already fixed" claims are genuinely fixed**, confirmed against
  fresh live evidence this session, not carried forward from an old claim: Integrations Configure,
  Grants.gov "Run Now" (a real POST that returned real live grants.gov opportunity data, not a mock),
  Scraping Targets link, Branding logo upload (control present, real target storage bucket confirmed
  to exist — no file was actually uploaded), and the Billing nav link.

## What's broken, and how bad

**One real application bug, but it's reachable from a real, unmodified primary-nav user flow — this
is the one finding in this phase worth your attention.**

`/donor-discovery/prospects/[id]` crashes to a blank page for any prospect whose linked directory
record has an incomplete `enrichment` object (missing `giving_focus_areas`/`in_kind_history_signals`,
which two unguarded `.length` accesses in `ProspectDetail.tsx` assume are always present). This
wasn't found as an isolated edge case — the element-wiring crawl found **6 real, visible links on the
primary-nav `/donor-discovery` page itself** ("View Prospect" + 5 "Review" buttons) that lead directly
into this crash. We independently spot-checked 5 of those 6 target prospects and confirmed the same
incomplete `enrichment` shape on each, and reproduced the same near-blank render on 4 of the 5 — so
this isn't one bad record, it's most of the real sampled prospect data. **Register: WGR-012 (the
original detail-page finding, P1) and WGR-017 (the same bug reached from real primary-nav links, P0)**
— we graded WGR-017 P0 specifically because it's a primary-nav page with visible links a real user
would click, not a drilldown someone has to already know the URL to reach.

Everything else broken this phase is the same one bug, counted at each layer it was found (the
render pass found it once as a direct navigation; the element-wiring crawl found it 6 more times as
the links that lead to it). There is no second distinct broken thing in this phase's results.

## What PT-01 confirmed or contradicted from PT-00

- **PT-00's `deadNav: []` claim (WGR-011) — confirmed, not contradicted.** PT-00's claim was a static
  string comparison; it never touched a running app. PT-01's live click-through of all 72 real nav
  elements found zero contradictions — every element that PT-00's static scan would have called a
  valid route also actually navigated correctly when clicked. Worth being precise about what this
  does and doesn't prove: it confirms every *reachable, documented* nav link resolves — it says
  nothing about the `/donor-discovery` prospect-detail crash below, because that bug lives on a
  sub-page reached by clicking a card, not a `nav-items.ts` entry, so it was outside what either
  PT-00's static check or PT-01's nav-surface click-through could have caught. The element-wiring
  crawl (a different check) is what found it.
- **WGR-004 (`/documents` 30s hang) — did not reproduce, twice, this session. Not confirmed fixed.**
  We're stating this as plainly as the evidence allows: two independent attempts this session
  (`durationMs` 3.7s–5.6s both times, real content, no error) failed to reproduce PT-00's hang. Root
  cause was never investigated in either phase. This could be genuine intermittent flakiness or two
  coincidentally fast responses — we logged the non-reproduction as its own finding (**WGR-014**,
  `UNVERIFIED`) rather than silently updating WGR-004 to resolved. Recommend re-testing `/documents`
  several more times at different times of day before treating this as closed.

## A methodology note worth knowing about, not a wiring finding

Partway through this phase, the shared local dev server this session started against developed a
corrupted client hydration bundle from an unrelated concurrent `next build` process writing into the
same `.next/` output directory — the same multi-worktree contention class already documented in
`WGR-001`, now shown to also apply to `next dev` vs. `next build` sharing one output directory, and
shown not to self-heal on its own. Worked around by launching a second, fully isolated dev server
rather than touching anyone else's process; the render-pass evidence is from that clean instance.
Full detail: `WGR-013`. Flagging this because if a future phase sees flaky failures against a shared
local server, this is the first thing to check, not a code regression.

## Recommendation for PT-02

**Go.** PT-01 confirmed the frontend wiring layer — routes, nav, and interactive elements — is
genuinely solid (99.9%+ correct at the element level, one real bug with a known root cause and a
narrow, well-understood blast radius). Nothing found this phase indicates a need to re-scope or slow
down.

Recommended next phase: **PT-02, API/CRUD/auth** — this phase deliberately stayed at the rendering
and click-target layer; it did not exercise data mutations, form submissions past the click, role/
permission boundaries beyond confirming the owner-gated nav items were reachable for an owner
account, or any of the 318 API routes PT-00's route manifest counted but PT-00-005's smoke sweep only
checked at the "no query params, does it 500" level. That's real, unaudited surface area, and it's a
natural continuation of this program's own escalation from static (PT-00) to live-render (PT-01) to
live-mutation (PT-02).

The one P0 (`WGR-017`) is worth fixing on its own merits before or alongside PT-02 starting — it's a
contained, two-line root cause (guard two `.length` accesses in `ProspectDetail.tsx`), not something
that needs a scope decision from you first — but it doesn't need to block your review of this phase
or the PT-02 authoring decision.
