# PT-01 — Phase 01 Summary (Render Pass)

Consolidated numbers for the PT-01 render-pass phase. Every number below cites the evidence
artifact it came from — re-run the cited verifier or read the cited file directly to reproduce it;
nothing here is asserted from memory.

## Scope

PT-01 goes deeper than PT-00-005's smoke sweep. PT-00 recorded HTTP status only. PT-01 records
whether the **rendered DOM** shows a Next.js error boundary, an empty shell, or real page content —
for every one of the 146 page routes in `test-evidence/pt-01/page-routes.json` (extracted 1:1 from
PT-00's `route-manifest.json`, verified by `node scripts/audit/verify-pt01-001.mjs`).

Method: real authenticated Playwright session via an admin-issued magic link for
`info@faithfoundationsf.org` (no password touched — same pattern as PT-00-005). For each route,
navigated and captured: (a) final HTTP status, (b) whether an error-boundary/500-class signature is
present in the rendered DOM, (c) whether the page shows real content vs. an empty/blank shell
(main-content text length + a loading-only-text check), (d) console errors (`console.error` +
uncaught `pageerror`) during the visit. Dynamic `[id]` routes used a real id resolved live via a
direct, scoped Supabase query against the authenticated org's own data wherever a row exists; where
none exists, the route was tested with a placeholder UUID and tagged `PENDING-SCOPE` (per PT-00's own
lesson, a "not found"/"invalid" render for a placeholder id is not counted as a bug).

## Dynamic-route id resolution

- **17 dynamic routes total.** 13 resolved to a real, live row for the authenticated org (or a
  platform-wide table where applicable — `agent_registry`, `corporate_prospects`,
  `foundation_directory`). 3 had no real row to resolve (`/autoapply/[sessionId]` —
  `automation_sessions` empty for this org; `/email/campaigns/[id]` — `email_campaign_sequences`
  empty; `/invite/[token]` — `user_invitations` empty), tested with a placeholder and tagged
  `PENDING-SCOPE`; all 3 rendered a real, correct "not found/unavailable" state, not a bug. 1
  (`/outreach/campaigns/[id]`) is a confirmed, id-independent server-side `redirect()` to
  `/email/campaigns` regardless of what id it receives (read directly from the page's own source) —
  tested with a placeholder since the id genuinely does not matter.
  Evidence: `test-evidence/pt-01/render-results.json` (`results[].idSource`/`.resolverTable`).

## A real, mid-session environmental blocker — read this before the results below

The shared local dev server this session started against (`localhost:3000`, plain `next dev`, no
build-output isolation) was found, partway through the first render-pass attempt, to have a
corrupted/missing client hydration bundle (`.next/static/chunks/main-app.js` and siblings, confirmed
absent at the filesystem level) — caused by a concurrent, unrelated `next build` process in the same
checkout writing to the same shared `.next/` directory. This is the same multi-worktree `.next`
contention failure mode `next.config.mjs`'s `experimental.cpus: 1` comment and register row **WGR-001**
already document, now shown to also apply to `next dev` vs. `next build` sharing one output directory
(previously only documented for `build` vs. `build`), and shown NOT to self-heal — the shared server
was still serving 404s for its own core JS chunks 50+ minutes and hundreds of requests after the
corruption began.

**Not worked around by killing anyone else's process.** Fixed for this session only by launching a
second, fully isolated `next dev` instance (a different port, a different `distDir`, via a temporary,
now-reverted `next.config.mjs` env-gated addition) — the original shared server was left running,
untouched, for whatever else depends on it. The render-pass evidence below is from that isolated,
clean instance. Full narrative, all evidence paths, and reproduction steps: register row **WGR-013**.

## Render-pass results (clean, isolated-server run)

- **145 / 146 routes render correctly** — real HTTP 200/expected status, no error-boundary signature
  in the DOM, real page content (not an empty/blank shell).
- **1 / 146 routes has a real, confirmed, reproducible application bug**:
  `/donor-discovery/prospects/[id]` — a real prospect whose linked directory row has a partial
  `enrichment` jsonb object crashes `ProspectDetail.tsx` (`Cannot read properties of undefined
  (reading 'length')`, two unguarded `.length` accesses on optional array fields), blanking the
  entire page. Reproduced 4 independent times with zero build-contention signature present — this is
  a real code defect, not environmental. Register row **WGR-012** (P1 — a drilldown detail page, not
  the literal top-level `/donor-discovery` primary-nav entry itself).

  Evidence: `test-evidence/pt-01/render-results.json`, `test-evidence/pt-01/render-failures/
  donor_discovery_prospects_id.png`.

## WGR-004 (`/documents` hang) — did not reproduce this session

Per this program's own explicit instruction, a non-reproduction of a previously-confirmed hang is
itself a finding, not silent evidence the bug is fixed. `/documents` was tested twice this session
(an initial dry-run smoke check, and the full 146-route sweep) — both times it rendered cleanly in
3.7–5.6 seconds with real content and no error. Root cause was never investigated in either PT-00 or
this session, so this could be genuine intermittent flakiness or two coincidentally-fast responses.
Logged as register row **WGR-014** (`UNVERIFIED`) — do not treat WGR-004 as resolved on this entry
alone; a future session should re-test `/documents` several more times, at different times of day, to
establish whether it's reliably reproducible, intermittent, or actually fixed.

## Register coverage

All PT-01 findings from this phase are recorded in `test-evidence/_register/WIRING_GAP_REGISTER.md`
as rows **WGR-012 through WGR-017**, each with a real evidence path under `test-evidence/pt-01/` and a
reproduction command/step. No PT-01 finding from this session exists outside the register.

## Verifier status

```
node scripts/audit/verify-pt01-001.mjs   -> PASS (page-routes.json matches PT-00 route-manifest.json's 146 page entries exactly)
node scripts/audit/verify-pt01-002.mjs   -> PASS (146/146 route coverage, every row has httpStatus/errorBoundaryInDom/hasRealContent/consoleErrors populated)
node scripts/audit/verify-pt01-003.mjs   -> PASS (72/72 nav elements across 5 surfaces, every row has surface/label/target/resolved_status/verdict populated)
node scripts/audit/verify-pt01-004.mjs   -> PASS (5307 elements across 56/56 declared pages -- 36/36 primary-nav, 20/20 sub-pages -- every row has required fields, every CONFIRMED-BROKEN row has a valid severity)
```

## PT-01-003 — nav resolution across every real nav surface

PT-00-003's `deadNav: []` finding (register row WGR-011) was a **static** cross-reference: it
compared `nav-items.ts`'s hrefs as strings against the build's route manifest, never touching a
running app. PT-01-003 settles the same question with **live** evidence — real click-through, in a
real authenticated Playwright session, against every element on the 5 real nav surfaces:

- **sidebar** — `NAV_ITEMS` (19 top-level entries incl. all 4 parents' children — Reports/
  Intelligence/Email/Outreach, 19 children total), `DONOR_DISCOVERY_NAV_ITEMS` (2, only rendered
  while `pathname` starts with `/donor-discovery`), `RESOURCES_NAV_ITEMS` (1), `SETTINGS_NAV_ITEM`
  (1) — **42 elements**.
- **admin** — `PLATFORM_NAV_ITEMS` (9), owner/admin-gated, tested with the confirmed-owner test
  account.
- **header_tabs** — `Header.tsx`'s `TABS` (6).
- **header_avatar_menu** — `Header.tsx`'s `MENU_LINKS` (5), a bonus surface beyond the four the task
  named explicitly (same file, same click-based method, cheap extra coverage of "every navigation
  surface").
- **settings_nav** — `src/app/(dashboard)/settings/layout.tsx`'s `NAV_ITEMS` (10, incl. both
  `ownerOnly` entries — Billing, White-Label — reachable since the test account is a real `owner`).

**Result: 72/72 resolve correctly (`resolved_status: "renders"`, verdict `CONFIRMED-OK`).** Zero
nav elements missing from the DOM, zero 404s, zero error boundaries, zero blank renders. No
contradiction of WGR-011's static claim. Evidence: `test-evidence/pt-01/nav-resolution.json`,
`test-evidence/pt-01/nav-resolution-run.log`. Register: **WGR-015**.

### A real testing-methodology pitfall found and fixed mid-session — not a nav-resolution.json row, but worth recording here for a future session's benefit

The first full run of this script reported 65 of 72 elements as `resolved_via_redirect` — plausible
on its face, but wrong. Root-caused via three throwaway reproduction scripts (not committed —
no persisted evidence file exists for the buggy run itself, which is why this isn't a formal register
row; the finding is recorded here in prose instead, and the fix is directly visible in the committed
script's own header comment and `URL_CHANGE_POLL_TIMEOUT_MS` logic): after a click, this app's
Next.js App Router client-side `<Link>` navigation does not reliably complete within
`page.waitForLoadState("networkidle")` returning plus a short fixed settle (400ms) — `networkidle`
can resolve before the freshly-mounted page has finished hydrating enough for the *next* link's
click handler to be live. The symptom was silent: `linkLocator.click()` returned without throwing,
but the browser never navigated at all — the script was reading stale content from the *previous*
page and (wrongly) classifying the unchanged `finalPath` as "resolved via redirect" rather than "the
click never navigated." Fixed by polling `page.url()` for an actual change (up to 15s) after every
click, before evaluating render state, and by adding a distinct `click_did_not_navigate` status so a
genuine stuck click is never again silently mislabeled as a redirect. Re-run after the fix: 0 of 72
elements showed this failure mode. Any future Playwright script that click-drives this app's nav
should poll for a URL change rather than trusting `networkidle` plus a short fixed delay between
consecutive client-side navigations.

## PT-01-004 — every `<a>` and `<button>` on the primary-nav page set + 20 sub-pages, wiring classified by handler binding

PT-01-002/003 answer "does this route render" and "does this nav element resolve" — neither checks
whether every individual interactive element ON a rendered page actually leads somewhere real.
PT-01-004 does: for the same 36 primary-nav pages (sidebar + admin + header tabs, verbatim from
PT-01-002's `PRIMARY_NAV_PATHS`) plus 20 hand-picked one-level-deep sub-pages (list/detail/create/
edit views, chosen from the real 146-route manifest), every `<a>`/`<button>`/`[role="button"]`
actually present in the rendered DOM was enumerated and classified — not just the elements
`nav-items.ts` already documents.

**Method, per the task's explicit "inspect the handler binding, not by firing it" instruction:**
links resolve their `href` (`#`/empty/`javascript:void` = dead; an in-page `#id` checked against a
real matching element; `mailto:`/`tel:` format-checked; external hosts format-checked only, never
live-fetched; a same-origin path reuses PT-01-002's/PT-01-003's already-computed evidence by exact
href or by matching route pattern wherever possible, and only falls back to a fresh authenticated
same-origin `fetch()` HEAD/GET for a genuinely novel path). Buttons are classified by reading the
DOM node's own React fiber props (`__reactProps$<id>`, the key React attaches directly to the
rendered node) for a bound `onClick`/`onPointerDown`/`onMouseDown` function, falling back to a
legacy inline `onclick` attribute, an ancestor `<a href>` the click would bubble into, or (after this
session's WGR-016 fix) any ancestor `<form>` for a `type=submit` button, since a plain native form
always has a real default action even with no JS layered on top. No element was ever `.click()`'d.

**Result: 5,307 elements across all 56 pages, 5,301 CONFIRMED-OK, 6 CONFIRMED-BROKEN (P0=6,
P1=0).** All 36/36 primary-nav pages and all 20/20 declared sub-pages have at least one crawled
element row — confirmed by `node scripts/audit/verify-pt01-004.mjs`, which also independently
re-checks every row's required fields and that every CONFIRMED-BROKEN row carries a real severity.
Evidence: `test-evidence/pt-01/element-graph.json`, `test-evidence/pt-01/element-wiring-run*.log`.

**The 6 CONFIRMED-BROKEN rows are all one underlying issue, not six separate bugs**: 6 real, visible
links on the primary-nav `/donor-discovery` page (1 "View Prospect", 5 "Review") to 6 distinct real
prospect detail pages, every one hitting the already-registered WGR-012 blank-render bug. This
session did not just trust the route-pattern reuse — it independently re-verified 5 of the 6 target
ids directly: a DB query confirmed each one's linked `donor_discovery_directory.enrichment` jsonb
shares the identical incomplete shape WGR-012's original id had, and a fresh authenticated render of
4 of the 5 reproduced the same near-blank `<main>` (57 characters, chrome only). See **WGR-017**.

**One false positive found in this session's own classifier, fixed before the pass completed, not
silently left in the results**: the first full run flagged `/nonprofits`'s "Search" button as
CONFIRMED-BROKEN (`form_no_submit_handler`) because its ancestor `<form>` has no `onSubmit` prop and
no `action` attribute. Investigated against the real source (`src/app/(dashboard)/nonprofits/
page.tsx`) and found this is a plain server component rendering `<form method="GET">` with zero
client JS — the native browser default (submit to the current URL) is a real, correct action, not a
missing one. Fixed `classifyButtonRow()` to treat any `type=submit` inside a `<form>` as wired
regardless of whether a JS handler is present, re-crawled `/nonprofits` alone with the corrected
classifier (not the whole 56-page set), and merged the corrected row back into the final results
before the pass was called complete. See **WGR-016**.

**Real interruption, handled honestly, not silently absorbed:** the first two attempts at this crawl
(`element-wiring-run.log`, `element-wiring-run-recovery.log`) were both killed mid-run before
completing — most likely by a foreground command timeout rather than an application error, given
free system memory was already low (~600-900MB of 16GB) during this session and no error appears in
either log at the point each attempt stops. Rather than restart from scratch a third time, the
script gained a resume mode this session: on start, it reads any existing `element-graph.json` and
skips a primary/sub-page only if that exact page already has crawled rows in it (checkpointing
writes only ever happen after a page's crawl fully completes, so a page present in the file is
genuinely done, never half-recorded). The 22 pages already checkpointed by the first attempt were
skipped and reused verbatim; the remaining 34 pages were crawled fresh across two more backgrounded
runs. Final result above is the union of all three runs, backed by the one final
`element-graph.json` — not three separate partial files.
