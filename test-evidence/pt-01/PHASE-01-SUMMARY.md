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
as rows **WGR-012 through WGR-014**, each with a real evidence path under `test-evidence/pt-01/` and a
reproduction command/step. No PT-01 finding from this session exists outside the register.

## Verifier status

```
node scripts/audit/verify-pt01-001.mjs   -> PASS (page-routes.json matches PT-00 route-manifest.json's 146 page entries exactly)
node scripts/audit/verify-pt01-002.mjs   -> PASS (146/146 route coverage, every row has httpStatus/errorBoundaryInDom/hasRealContent/consoleErrors populated)
```
