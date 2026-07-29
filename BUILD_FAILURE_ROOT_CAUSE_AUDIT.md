# Build Failure Root Cause Audit

**Date:** 2026-07-29
**Scope:** Railway (`benavora-worker`), Vercel (`benavora`), GitHub Actions — deployment/build/run history retrieved directly via Railway CLI (`railway deployment list`, `railway logs --build`), the Vercel MCP (`list_deployments`, `get_deployment_build_logs`), and `gh run list` / `gh run view --log-failed`. Diagnostic only — no code, config, or CI changes were made.

**Data window:** GitHub Actions and Vercel both returned data cleanly back to 2026-07-17 (~12 days). Railway's CLI (`--limit 200`) also bottoms out at 2026-07-17T22:38 — this appears to be the practical retention/pagination ceiling for this account, not a deliberate 30-day cutoff; genuine 30-day coverage (back to ~06-29) was not retrievable through the CLI. All findings below are anchored to real, timestamped log output — not summarized from commit messages or governance docs.

---

## Category breakdown

| Category | Count | % of all failures |
|---|---|---|
| (a) TypeScript/compile error | **~138** (135 Railway + 3 Vercel) | 74% |
| (d) Infrastructure (Railway trial/billing) | 1 sustained incident, blocked ~6.4 days / ~100+ commits | — (not a per-build count; see below) |
| (c) Dependency install failure | **5** (Railway, all 2026-07-29) | 3% |
| (e) Other — genuine test-code bug | **all sampled runs** of GitHub Actions "Daily Test Suite" | separate axis, see below |
| (b) Missing/invalid env var or API key | 0 *build* failures, but 1 live runtime failure found (see note) | — |

Raw counts, by platform:

- **Railway (`benavora-worker`)**, 200 deployments sampled (2026-07-17 → 2026-07-29): **140 FAILED**, 1 SUCCESS, 59 REMOVED.
- **Vercel (`benavora`)**, 40 deployments sampled (2 pages, same window): **3 ERROR**, 37 READY.
- **GitHub Actions**, 100 runs sampled (2026-07-17 → 2026-07-29): **100 failure**, 0 success. (Two workflows: "Daily Test Suite", "Deploy Check".)

---

## The single most common recurring root cause

**Category (a), TypeScript/compile error, driven overwhelmingly by one file: `worker/autonomous-orchestrator.ts`.**

Build-log sampling at three independent points spanning the failure window — 2026-07-19 (`b60dfd82`), 2026-07-20 (`e8a91bf3`), 2026-07-21 (`c0223a9f`) — all show the **identical** unresolved TypeScript errors:

```
worker/autonomous-orchestrator.ts(266/322/884/1068,35): error TS2339: Property 'matched' does not exist on type 'AutonomousAgentResult'.
worker/autonomous-orchestrator.ts(266/322/884/1068,63): error TS2339: Property 'found' does not exist on type 'AutonomousAgentResult'.
```

By 2026-07-21, a second defect had stacked on top in the same build (`worker/autoapply-autonomous-orchestrator.ts`, 9 occurrences of `error TS18048: 'prospect' is possibly 'undefined'`), meaning **new code kept landing on top of an already-broken build for days** without the underlying compile error ever being fixed. This single defect (real fields are `itemsFound`/`itemsProcessed`; the code reads nonexistent `.matched`/`.found`) is the most-repeated failure signature in the entire dataset — it alone accounts for the large majority of Railway's 140 FAILED entries between 07-17 and 07-21. It was eventually fixed by commit `d59ea5c` ("fix(worker): resolve TS build errors blocking Railway deploy since 07-19").

**Runner-up, and arguably more damaging: a silent ~6.4-day total deploy blackout.** Between `2026-07-21T05:59` and `2026-07-27T15:26`, Railway recorded **zero deployment attempts of any kind** — not FAILED, not REMOVED, nothing — despite ongoing commits to `main` throughout that window. This matches the documented Railway trial/billing expiration (infrastructure, category d): the deploy trigger itself was blocked at the account level, so the TS fix that landed in that window had no way to actually reach production until billing was resolved around 2026-07-28. This means for over 6 days, **it was impossible to know from Railway's own data whether the worker's code was fixed or broken** — the platform simply stopped trying.

**Most recent, and 100% of today's failures: `better-sqlite3` (transitive dependency of `camoufox-js`).** All 5 Railway FAILED deployments on 2026-07-29 (03:24–04:08) show the identical error:

```
node_modules/better-sqlite3 install: gyp ERR! find Python ... Could not find any Python installation to use
[ERRO] [5/7] RUN npm install -g pnpm && pnpm install --frozen-lockfile
Build Failed: ... exit code: 1
```

`worker/Dockerfile` is `node:20-slim` — it has no Python, so `better-sqlite3`'s `node-gyp rebuild` install script fails outright. This is category (c), dependency install failure. It started the moment `camoufox-js` was added (commit `edad095`, which pulls in `better-sqlite3` transitively for its WebGL fingerprint sampler) and will recur on **every single Railway deploy** until resolved — `worker/` never imports anything from `scraper-v2/` (confirmed via `grep -rl "scraper-v2" worker/` — no matches), so this is pure collateral damage from a monorepo-wide `pnpm install --frozen-lockfile` in the Dockerfile installing dependencies the worker doesn't even use.

---

## Deploy-on-every-push check

**GitHub Actions — already fixed, not a current cause.** Both workflows (`daily-tests.yml`, `deploy-check.yml`) had `on: push: branches: [main]` until commit `8b8c991` ("fix: remove push trigger from workflows — schedule and manual only", 2026-07-17 18:31) removed it. They are now `schedule` (daily 05:00 UTC) + `workflow_dispatch` only. The dozens of same-minute push-triggered runs visible in the history (07-17, before 18:31) are historical artifacts of the old config, not current behavior.

**Vercel — still triggers on every push, confirmed with real evidence, but is not currently a source of failures.** Docs-only commits (`docs: confirm request_profiles seeded...`, `docs: full migration-vs-production audit`, `docs: re-verify process-followups...`, `docs: nav/admin surface audit`, `docs: demo readiness audit`, `docs: AG-38 improvement agent status check`) each produced their own full `READY` production deployment, identical in kind to feature commits. No `ignoreCommand` is configured in `vercel.json` (it only defines `functions`/`crons`/`headers`) and none was evident in deployment behavior. This is real, ongoing build-minute waste, but since Vercel's build succeeds almost every time, it isn't the explanation for Vercel *failures* — only for volume.

**Railway — still triggers on every push, and this IS actively causing damage.** `railway.json`'s `serviceManifest.build.watchPatterns` is `[]` (empty = no path filter — every push to `main` rebuilds the whole worker Docker image, regardless of whether `worker/` changed at all). Direct evidence: 59 of the 200 sampled deployments are `REMOVED` (canceled because a newer push arrived before the build finished) — 13 of these cluster in a single ~13-hour burst from 2026-07-27 15:26 through 2026-07-28 04:50, exactly matching the "overnight session" of many rapid consecutive commits. **Because Railway's Docker build is much slower than Vercel's incremental Next.js build, a high commit-velocity session effectively prevents the worker from ever completing a deploy** — each new commit cancels the last one's in-flight build before it can finish, success or fail. This is a separate, real mechanism from "every failure is a real bug" — some of the apparent chaos is pure over-triggering, not code quality.

**Net:** your hypothesis was right for Railway, already fixed for GitHub Actions, and real-but-non-fatal for Vercel.

---

## Other findings worth flagging

- **GitHub Actions "Daily Test Suite" fails 100% of sampled runs**, and it's a real bug, not flakiness: `TypeError: supabase.from is not a function` in `tests/api/intelligence.test.ts` → `src/app/api/intelligence/logic-model/route.ts:63`, confirmed byte-identical across two runs 6 days apart (2026-07-23 and 2026-07-29), plus 2 consistently-failing assertions in `tests/unit/draft-generation.test.ts`. This is a broken Supabase client mock in the test harness — category (e), and it means the daily suite has provided zero real signal for at least a week.
- **Vercel's 3 ERROR deployments are one incident, not three.** All 3 are the same `@typescript-eslint/no-unused-vars` violation (`'request' is defined but never used`) in 3 admin route files, clustered within a 16-minute window on 2026-07-25, fixed immediately after by commit `57ad7e93`. Confirms the existing memory note that `next build` lints the entire repo.
- **Not a build failure, but a live env-var problem found during a separate check this session:** `ANTHROPIC_API_KEY` in `.env.local` is currently returning `401 authentication_error: "API key is invalid."` on real calls. This wouldn't show up in a Railway/Vercel *build* log (it's a runtime failure, not a compile-time one) but is worth surfacing here since the user asked about env-var-driven failures broadly.

---

## Ranked, permanent fixes

**1. Fix `worker/autonomous-orchestrator.ts`'s `AutonomousAgentResult.matched`/`.found` reference (and verify no other stale-field regressions like it).**
This was already fixed once (commit `d59ea5c`) but the underlying pattern — code reading fields that don't exist on a shared result type — is exactly the kind of error a type check should catch *before* commit, not discover on Railway 30+ times in a row. Permanent fix: add a `pnpm tsc -p worker/tsconfig.json --noEmit` step as a required local/CI gate before any worker-touching commit is pushed, so this class of error is caught in seconds locally instead of burning a 10+ minute Railway Docker build repeatedly. (`gates/compile.ps1` in the FORGE queue system already does something like this for the main app — worker needs the same gate wired into the actual push path, not just FORGE's opt-in queue runs.)

**2. Stop the worker's Railway build from ever depending on packages the worker doesn't use — starting with removing `camoufox-js`/`better-sqlite3`.**
Two layers to this, both permanent (not band-aids):
   - **Immediate:** `camoufox-js` is already documented as non-functional on this stack (segfaults, requires Node ≥22) and unused by anything in `worker/`. Remove it (and thus `better-sqlite3`) from `package.json` entirely rather than leaving it installed-but-dead — it will keep breaking every Railway deploy until it's gone, since nothing currently guards against it.
   - **Structural:** `worker/Dockerfile` runs `pnpm install --frozen-lockfile` against the **entire monorepo's** `package.json`, so any dependency added anywhere in the repo (even a one-off CLI script never touched by the worker) can break the worker's production build. Give the worker its own scoped dependency list (a `worker/package.json` with only what `worker/` actually imports, or a `pnpm deploy --filter` production-scoped install) so the two build surfaces stop sharing a single point of failure. This is the fix that prevents *the next* camoufox-js-style incident, not just this one.

**3. Set a path filter on the Railway service so it only rebuilds when `worker/`-relevant files change, and add a Railway account/billing health check to the pre-flight routine.**
   - Set `serviceManifest.build.watchPatterns` (currently `[]`) to scope Railway's GitHub-triggered rebuilds to `worker/**`, `package.json`, and `pnpm-lock.yaml` — docs-only and app-only (`src/app/**`) commits should never trigger a worker Docker rebuild at all. This directly eliminates the REMOVED-pileup pattern during high-commit-velocity sessions, since unrelated commits won't compete for the same build slot.
   - Separately, add a Railway billing/trial-status check (`railway status` or the GraphQL API) to whatever session-start routine already checks things like DDL credentials — the 6.4-day silent blackout was invisible until someone thought to check, and it fully masked whether code fixes during that window were actually working.

Vercel's every-push rebuild is real but lower priority to fix (it isn't failing, just spending build minutes) — a `git diff --quiet HEAD^ HEAD -- src/ package.json` style `ignoreCommand` in `vercel.json` would skip builds for pure `.md`/doc changes if reducing Vercel build volume becomes worth the effort later.
