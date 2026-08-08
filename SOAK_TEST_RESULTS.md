# SOAK_TEST_RESULTS.md

**Date:** August 8, 2026
**Feature under test:** FEATURE_REGISTRY_v2.md row T7 ("Soak Tests" — "Enrichment engine under sustained load")
**Script targeted:** `pnpm scrape:nonprofits` → `scripts/run-nonprofit-scraper.ts` → `runNonprofitScraper()` in `src/lib/scraper/nonprofit-scraper.ts` (the real, existing, standalone StealthEngine-based scraper — NOT the separate, partially-unverified `scraper-v2`/"Universal Scraper" pipeline documented elsewhere in this registry).
**Method:** genuine live run, real external network calls (real nonprofit websites, real Chromium via Playwright/StealthEngine), real Supabase writes against production. No mocks, no simulation.

---

## Setup

Before running, queried the real candidate population live against production (the exact `WHERE` clause `runNonprofitScraper()` itself uses, read directly from source rather than assumed):

```
nonprofits WHERE website IS NOT NULL AND contact_emails IS NULL AND revenue_amount >= 750000
```

**Result: 124,755 real candidate rows** (this count has grown substantially since the 363 rows recorded in this file's own header comment as of 2026-07-27 — the `nonprofits` table has clearly had a large ingestion pass since then; not investigated further here, out of scope for this test).

This script has no `startOffset`/`batchLimit` parameters (unlike the sibling foundation scraper) — it runs to exhaustion against the current candidate pool using a keyset cursor, by design (see the file's own header comment: idempotent, COALESCE-style writes mean a killed run is always safely restartable from the top). With 124,755 real candidates, a full run was never going to complete inside any reasonable prompt-execution window, so per this task's own instructions the run was capped at a bounded wall-clock duration and evaluated as a partial run.

## Run parameters

- **Invocation:** `node node_modules/tsx/dist/cli.mjs scripts/run-nonprofit-scraper.ts` (functionally identical to `pnpm scrape:nonprofits` — invoked directly to get a stable, trackable PID for memory sampling instead of through the `pnpm` wrapper).
- **Real script config** (read from source, not assumed): `BATCH_SIZE = 10`, `CONCURRENCY = 2` (2 persistent `StealthEngine`/Chromium contexts), `MIN_REQUEST_DELAY_MS = 500` per context.
- **Wall-clock cap:** ~14 minutes of live execution (started ~2026-08-08T07:10:52Z, force-stopped ~2026-08-08T07:27:40Z) — shorter than the 15-30 minute range suggested in the task, capped a bit earlier once it became clear the run had converged on a single, 100%-reproducible failure mode (see below) and further wall-clock time would not have changed the finding, only the count of records hitting the identical bug.
- **Process management:** launched as a tracked background task, memory sampled via `Get-Process` at intervals, cleanly terminated via `TaskStop` at the cap (not a crash, not a hang — a deliberate, controlled stop). No orphaned Node or Chromium processes remained afterward (verified: `Get-Process -Id <tracked PIDs>` returned no results post-stop).

## Results

| Metric | Value |
|---|---|
| Candidate pool at start | 124,755 |
| Candidate pool at end (re-queried live, same WHERE clause) | 124,755 — **unchanged** |
| Distinct records attempted (by first-attempt log lines) | 90 |
| Records successfully enriched (real DB write) | **0** |
| Records failed | 90 (100%) |
| Total fetch-failure log lines | 268 (avg ~3.0 failed attempts/record — i.e., every record exhausted all 3 retries) |
| Failures attributable to `Cannot navigate to invalid URL` | 268 / 268 (**100%**) |
| Failures attributable to HTTP 403/429 (rate limiting) | 0 |
| Failures attributable to CAPTCHA block | 0 |
| Failures attributable to any other cause | 0 |
| Unrecoverable/crash errors | 0 |
| Process crash or hang | None — clean run, cleanly stopped, no zombie processes |

### Memory

Sampled the real Node process (PID 28532, the long-lived one of the ~3 processes tsx spawns at startup — the other two were short-lived tsx/esbuild helpers that exited within the first minute):

| Time into run | RSS |
|---|---|
| ~t+0 (shortly after start) | 47 MB |
| ~t+4 min | 117 MB |
| ~t+14 min (before stop) | *(PID exited on TaskStop; last live sample was the t+4min reading — see note below)* |

**Honest limitation, not glossed over:** this machine had ~36 pre-existing, unrelated `chrome.exe` processes running at the time of this test (other sessions/worktrees active concurrently — `git status` shows 6 other active agent worktrees in this repo right now), so summing "all chrome.exe processes" memory would have been meaningless noise, not a signal specific to this scraper. Per-record `rotateAndWait()` also launches a brand-new Chromium context on every retry (see below), so this scraper's own Chromium memory footprint is inherently short-lived and hard to isolate from unrelated system activity with a coarse `tasklist`/`Get-Process` sample. The one clean signal obtained — the main Node process growing from 47MB→117MB in the first 4 minutes — is consistent with normal Node/Playwright driver overhead accumulating across ~30 short-lived browser context launches in that window, not conclusive evidence of a leak on its own. **No memory-leak verdict can be honestly drawn from this run** — the dominant, conclusive finding here is a 100% correctness failure that occurred too fast and too uniformly to give a leak enough runway to become visible or worth chasing further before the underlying cause (below) makes the whole run moot.

## Root cause (found and diagnosed, NOT fixed — per this task's explicit instruction)

**Every single failure in this run traces to one bug: `nonprofit-scraper.ts` never validates or normalizes the `website` column's scheme before handing it to Playwright's `page.goto()`.**

Confirmed by reading the source directly:
- `src/lib/scraper/nonprofit-scraper.ts`'s `scrapeContact()` calls `throttledFetch(pooled, website)` → `pooled.engine.fetchPage(url)` with `row.website` used completely as-is. No `grep -n "http"` match anywhere in this file.
- `src/lib/scraper/stealth-engine.ts`'s `fetchPage()` calls `page.goto(url, {...})` directly on that same unmodified string. Playwright's `page.goto()` requires an absolute URL with a scheme (`http://`/`https://`); a bare domain like `www.example.org` throws `page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL` — every time, deterministically, with zero network I/O ever attempted.
- That thrown error is caught by `fetchPage()`'s own `catch` block, which — indistinguishable from a real transient network failure — triggers `rotateAndWait()`: **a fresh 5-15 second random sleep plus a full new browser-context relaunch**, then retries. For a permanently-malformed URL, this happens twice per record (retry 2 and retry 3) before the record is finally given up on.

**Scope of the bug, quantified against the real live candidate population** (sampled 500 real candidate rows via a direct PostgREST query during this session): **476 of 500 (95.2%) of `nonprofits.website` values are missing an `http(s)://` prefix.** Examples pulled directly from the real table: `WWW.HOWARDYOUNGFOUNDATION.ORG`, `HEALTHYSTARTCOALITIONPASCO.ORG`, `WWW.SEBWEF.ORG`, `WWW.CLAREMONTLINCOLN.EDU`. This matches this run's own observed 100% failure rate almost exactly (90/90 distinct records attempted this run all failed on the identical error).

**A second, related data-quality defect surfaced by the same log**: a non-trivial number of candidate rows have `website` values that aren't URLs at all and never should have passed whatever wrote them — literal strings `N/A`, `NA`, and even an email address (`ALLMY424@AOL.COM`) stored in the `website` column. These fail for the same reason (no scheme, not a domain either) but represent a distinct upstream data-entry/ingestion problem on top of the missing-scheme issue.

**Compounding cost, not just a silent no-op**: because the malformed-URL exception is treated identically to a real transient failure, each doomed record costs **two full `rotateAndWait()` cycles** (≈10-30 seconds of pure sleep, plus two full Chromium context relaunches) before the scraper gives up and moves to the next record — for a class of input that could be detected and skipped (or corrected with a scheme prefix and retried) in microseconds with a single regex check before ever touching Playwright. At the observed real throughput (90 distinct records across ~14 minutes with 2 concurrent workers), processing anywhere near the full 124,755-row candidate pool at this rate is not practically feasible, and the vast majority of that time would be spent on retries that can never succeed.

## Verdict

**The enrichment path does NOT hold up under sustained load against its own real, current candidate population — not because of external rate-limiting, memory exhaustion, or a crash (none of those occurred; the process ran cleanly and was cleanly stopped), but because of a real, previously-undocumented correctness bug that makes ~95% of real candidate rows permanently unenrichable and burns real wall-clock time (browser relaunches, multi-second sleeps) proving that on every single row, every single run.** This is a distinct, separate bug from anything already tracked elsewhere in this project's memory/governance docs (the dead `ANTHROPIC_API_KEY`, the PostgREST 1000-row cap, the BMF ingest column-scramble bug, etc.) — it does not call Claude at all and was not previously flagged anywhere found in this repo's governance history.

Per this task's explicit instruction, **this is not fixed here** — it is a real, separate bug, flagged plainly for its own fix pass. A plausible fix shape (not implemented): before calling `throttledFetch`/`fetchPage`, normalize `row.website` — if it doesn't start with `http://`/`https://`, prepend `https://`; if after trimming/uppercasing it doesn't look like a domain at all (e.g. contains `@`, or is a literal `N/A`/`NA`), skip the record without ever invoking Playwright, and consider writing a distinct "skipped, malformed URL" outcome instead of silently leaving `contact_emails` null forever (indistinguishable today from "genuinely tried and found nothing"). Since this scraper is confirmed live-scheduled weekly (`worker/scheduler.ts`'s `nonprofit-enrichment-weekly` job per FEATURE_REGISTRY_v2.md S3/S4), this bug has very likely been silently suppressing the real weekly enrichment rate for as long as that job has been running against `nonprofits` — worth prioritizing.

No 429/403/CAPTCHA rate-limiting was observed in this run at all — that specific soak-test dimension (does the target sites' own rate limiting degrade the scraper under sustained load) could not actually be exercised, because the malformed-URL bug prevents the vast majority of records from ever reaching a real HTTP request in the first place. Re-running this soak test after the URL-normalization bug is fixed would be needed to genuinely test rate-limiting/sustained-load behavior against real external sites — this run tested a different, and evidently more urgent, part of "sustained load behavior."

---

## FEATURE_REGISTRY_v2.md update

Row T7 updated: **PLANNED → BUILT.** A real soak test now exists and was run for real against `scripts/run-nonprofit-scraper.ts` (`pnpm scrape:nonprofits`), with a genuine live-network run, real memory sampling, and a real, reproducible, quantified finding (100% failure rate against the real candidate population, root-caused to a URL-normalization bug — not to rate limiting, memory, or a crash). This satisfies "soak test exists and was run for real" — it does not mean the enrichment engine itself passed; the run surfaced a real, high-priority, previously-undocumented bug, which is exactly what a soak test is for.
