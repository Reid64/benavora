# PT-00 — Phase 00 Summary (Baseline)

Consolidated numbers for the PT-00 evidence-infrastructure/baseline phase. Every number below cites
the evidence artifact it came from — re-run the cited verifier or read the cited file directly to
reproduce it; nothing here is asserted from memory.

## Route inventory

- **Total routes discovered: 464** (146 pages, 318 API routes).
  Evidence: `test-evidence/pt-00/route-manifest.json` (`routeCount`, `routes[]`), reproducible via
  `node scripts/audit/verify-pt00-003.mjs`.

## Dead-nav / orphan-route counts

- **Dead-nav entries: 0.** No `nav-items.ts` entry points at a route that doesn't exist.
  Evidence: `route-manifest.json` (`deadNav: []`); register row **WGR-011** (CONFIRMED-OK).
- **Orphan routes: 78** of 146 pages have no incoming link found by scanning `nav-items.ts`.
  Evidence: `route-manifest.json` (`orphanRoutes[]`); register row **WGR-010** (CONFIRMED-OK — not a
  defect, investigated). 6 live in `Header.tsx`'s top tab bar by design (Dashboard/Research/
  Opportunities/AutoApply/Draft Generator/Donor Discovery — `nav-items.ts`'s own header comment says
  so, confirmed against `Header.tsx`'s `TABS` array). The rest split into equally explainable
  categories: marketing pages, auth pages (login/register/forgot-password/reset-password),
  `/settings/*` subsections reached via `SettingsNav` rather than the sidebar, and drilldown/action
  pages reached by a link from a list page rather than the sidebar. `nav-items.ts` was never meant
  to be the single index of every reachable page. **This is a real, already-explained result, not an
  open finding** — kept in the register (not re-flagged) so it doesn't get re-investigated cold.

## Env findings by severity

Method: repo-wide grep for every `process.env.VAR`/`process.env['VAR']` reference (76 distinct
vars found), cross-checked against local `.env.local` variable **names only** — no secret value was
ever read or recorded. Evidence: `test-evidence/pt-00/env-audit.json`, reproducible via
`node scripts/audit/verify-pt00-004.mjs`.

| Severity | Count | Vars | Register row(s) |
|---|---|---|---|
| P1 | 2 | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` | WGR-002 |
| P2 | 13 | `CREDENTIAL_ENCRYPTION_KEY`, `CRON_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `INTEGRATION_KEY_SECRET`, `PORTAL_ENCRYPT_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `SCRAPER_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `UNSUBSCRIBE_HMAC_SECRET`, `WORKER_ID` | WGR-003 |

**Important scope note:** this audit checked local `.env.local` presence only. It did **not** check
whether these 15 vars are set in Vercel/Railway production environments — a P2/P1 row here means
"absent from this session's local dev file," not "absent from production." Confirming production
env-var completeness is a separate, unperformed check.

Of the 76 total vars referenced, 23 are `production_required`; 9 are present in `.env.local`; 52 are
`missing_optional` (dev-tooling/feature-specific/have a code default — not findings); 1
(`FAITH_FOUNDATION_ORG_ID`) is `present_optional`.

## Smoke pass/fail counts

Method: authenticated Playwright sweep of all 464 manifest routes against a local `pnpm dev` server
(dynamic `[id]` routes probed with a placeholder UUID). Evidence:
`test-evidence/pt-00/smoke-results.json`, reproducible via `node scripts/audit/verify-pt00-005.mjs`.

- **399 / 464 pass cleanly** (2xx/3xx, `rendered_ok: true`).
- **65 / 464 did not pass the naive classifier** — but only **6 of those 65 are real, confirmed
  findings**; the other **59 are expected, correct rejections** produced by the sweep's own blind
  probing method, not bugs:

| Response | Count | Why | Bug? |
|---|---|---|---|
| `404` | 27 | Dynamic route probed with a placeholder (`00000000-...`) UUID that doesn't exist | No — correct "not found" |
| `400` | 18 | Route requires query params the blind sweep didn't supply | No — correct validation rejection |
| `401` | 14 | Cron/secret-protected route hit with no auth | No — correct rejection |
| `500` | **5** | Real server error on an authenticated, no-param request | **Yes — WGR-005 through WGR-009 (P1)** |
| timeout (`null` status) | **1** | `/documents` page hung past 30000ms | **Yes — WGR-004 (P0)** |

**Real, confirmed smoke failures: 6** (5 API 500s + 1 page timeout). Full detail and reproduction
steps for each are in `WIRING_GAP_REGISTER.md` rows WGR-004 through WGR-009. `/documents` (WGR-004)
is graded **P0**, not P1 — it's a literal top-level `NAV_ITEMS` sidebar entry
(`src/components/layout/nav-items.ts`), not a sub-page, so any authenticated user clicking that
sidebar item hits a hang today. The 5 API 500s (WGR-005 through WGR-009) were each checked for a
dashboard-page consumer via repo-wide grep before grading — none back a primary-nav page's core
data load, so all 5 are P1, not P0. One of the six (`/api/outreach/sequences`, WGR-007) re-confirms
a previously-documented, still-open gap (`followup_sequences` table absent in production, per
`STATE_OF_THE_BUILD.md`'s 2026-08-13 session) rather than being a new regression.

## Build-config disposition (WGR-001)

`next.config.mjs`'s `experimental.cpus` build-worker cap (the PT-00-002 check, guarding against the
documented multi-worktree memory-thrash/timeout failure mode) was found **already present**
(`cpus: 1` at `next.config.mjs:35`) — **not a gap**. Live-verified in the PT-00-002 session with a
real, cold-cache build: `.next` deleted, `pnpm run build` run fresh, completed in **97.880s, exit
code 0**, with the `✓ Compiled successfully` marker present and no crash/timeout signature in the
output (a prior, now-overwritten `build-proof.txt` from an earlier attempt in this same cycle showed
a genuine failed run with the exact `STATUS_DLL_INIT_FAILED` signature the cap's comment describes,
confirming the failure mode is real under contention, not a coincidence of an already-warm cache).
Logged as register row **WGR-001** (CONFIRMED-OK) for traceability, not as an actionable finding.
Evidence: `test-evidence/pt-00/build-config.txt`, `test-evidence/pt-00/build-proof.txt`.

## Register coverage

All PT-00 findings from this phase are recorded in `test-evidence/_register/WIRING_GAP_REGISTER.md`
as rows **WGR-001 through WGR-011**, each with a real evidence path under `test-evidence/pt-00/` and
a reproduction command/step. No PT-00 finding from this session exists outside the register.

## Verifier status

All 6 PT-00 verifiers pass as of this consolidation:

```
node scripts/audit/verify-pt00-001.mjs   -> PASS (register + legend present)
node scripts/audit/verify-pt00-002.mjs   -> PASS (build-config + clean build proof)
node scripts/audit/verify-pt00-003.mjs   -> PASS (464 routes, deadNav=0, orphanRoutes=78)
node scripts/audit/verify-pt00-004.mjs   -> PASS (76 vars, 15 findings, no secret-value leak)
node scripts/audit/verify-pt00-005.mjs   -> PASS (464/464 route coverage, 6 not rendered_ok, 5 hard 500s)
node scripts/audit/verify-pt00-006.mjs   -> PASS (this summary + review pack + register non-empty)
```
