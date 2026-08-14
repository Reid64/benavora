# Intelligence Library Corpus — Nights 2-7 Scoping (Row D5)

**Date:** 2026-08-13
**Scope of this document:** research + estimation only. Nothing was executed. No ingestion script was
run, no queue was launched, no data was written. This exists to answer one question: is it safe to run
the remaining data-loading work unattended in a single long FORGE prompt, or does it need to be split
across multiple sessions/days.

**Bottom line: split across multiple sessions. Do not run unattended in one long FORGE prompt.**
Not because of API rate limits (the 4 sources that already have working scripts are fast and
essentially unthrottled) but because of a scope mismatch this research uncovered: the "night" that
row D5 and Directive 3 are counting is not one thing. Two incompatible schedules share the same "Night
1-7" numbering in this repo, and the real remaining work is dominated by **building ~8-11 web scrapers
that don't exist yet**, each gated by a 5-second same-domain delay and a robots.txt compliance check
per `BEHAVIORAL_CONTRACTS.md` §21 — not by re-running fast REST API pulls. See §4.

---

## 1. What "Night 1" actually was — two colliding schedules

There are two different documents in this repo that both use "Night 1" through "Night 7" language for
the Intelligence Library, and they do not describe the same work:

1. **`INTELLIGENCE_BUILD_ROADMAP.md`** (June 20, 2026, the original planning doc). Its "Nights 1-7" are
   **FORGE code-build nights** — Night 1 built the pgvector schema/worker/RAG integration/NIH ingestion
   *script*; Night 2 was to build reviewer-rubric extractors and a logic-model library; Night 3 was
   Census/HUD/SAMHSA/BLS/CDC *statistical* data integration; Nights 4-7 were budget-template libraries,
   grantmaker-profile builders, narrative-pattern/DNA scoring, and cross-library UI polish. These are
   almost all **application features**, not funded-proposal ingestion. Its own "Parallel Data Ingestion
   Runs" table (§136) is a *separate* concept — data pulls that run alongside the code-build nights on
   a second machine.
2. **`STANDING_DIRECTIVES.md` Directive 3** (July 16, 2026). Its "Build Night Schedule" table is a
   verbatim restatement of the same roadmap.md night definitions (rubrics, need statements, budget
   libraries, etc.) — still code-build nights, not data nights. But Directive 3 *also* has a completely
   different table, "Funded Proposal Sources" (15 rows: NIH NIAID, NIH RePORTER, NSF, HRSA, HUD, SAMHSA,
   DOJ OJP, university libraries, community foundations, RWJF, Casey, Kellogg, Federal Register, Gates,
   Wellcome), each with an estimated proposal count. This table has no night numbers attached to it at
   all.

**Row D5 and this task's framing ("1 of 7 planned data-loading nights") map onto neither schedule
cleanly.** The task pins the four sources actually in scope explicitly (rows #166-169: NIH RePORTER,
NSF, Federal Register, SAMHSA/HRSA), which is a subset of Directive 3's 15-source table, filtered down
to the 4 that already have a real ingestion script. Given that, this document treats "Night 1" as
**the one real, dated ingestion event that used those scripts**, found via git/DB evidence below, and
treats "Nights 2-7" as "everything left to reach Directive 3's full 15-source, 2,000+-proposal target."
That is the only reading that is falsifiable against real repo history — the doc-internal "Night 2-7"
labels are not.

---

## 2. Ground truth: what Night 1 actually ran (git + live DB evidence)

### The four scripts (rows #166-169)

All four were written in one sitting, 2026-07-16, 22:34-23:09 (`d410492`, `b6a8702`, `6e40593`,
`a8d63cf`), each targeting `intelligence_funded_proposals` (migration 048):

| Script | `pnpm` command | Source label | API | Auth | Page size | Hard caps |
|---|---|---|---|---|---|---|
| `ingest-nih-reporter.ts` | `ingest:nih-reporter` | `NIH_REPORTER` | api.reporter.nih.gov v2 (POST) | none | 500/page | `TARGET_INSERTED=2000`, `MAX_PAGES=20` |
| `ingest-nsf-awards.ts` | `ingest:nsf` | `NSF_AWARDS` | api.nsf.gov v1 (GET) | none | 25/page (API max) | `TARGET_INSERTED=300`, `MAX_PAGES=60` |
| `ingest-federal-register.ts` | `ingest:federal-register` | `FEDERAL_REGISTER` | federalregister.gov v1 (GET) | none | 100/page | `MAX_PAGES=10`, filtered to HUD/HHS/DOJ NOTICE docs with NOFA-ish titles |
| `ingest-samhsa-hrsa.ts` | `ingest:samhsa-hrsa` | `USASPENDING` | api.usaspending.gov v2 `spending_by_award` (POST) | none | 100/page | `LAST_PAGE=10` (hard 1,000-row ceiling by design) |

None of the four scripts has a `sleep`/backoff/delay call anywhere in its request loop — each fires the
next page's request immediately after the previous one resolves. This is a real, load-bearing fact for
the rate-limit question in §3.

### What actually executed (live `intelligence_funded_proposals` query, by `source`, grouped with
`min(created_at)`/`max(created_at)`)

| source | rows | first row (UTC) | last row (UTC) | span |
|---|---|---|---|---|
| `NIH_REPORTER` | **2,442** | 2026-07-26 06:36:05 | 2026-07-26 06:37:14 | **69 sec** |
| `NSF_AWARDS` | **614** | 2026-07-26 06:35:03 | 2026-07-26 06:38:07 | **3.1 min** |
| `FEDERAL_REGISTER` | **0** | — | — | never run |
| `USASPENDING` | **0** | — | — | never run |
| `NIH` (old seed) | 11 | 2026-06-20 18:24 | 2026-06-20 18:31 | 7.3 min |
| `NIH_NIAID` / `HUD` / `DOJ_OJP` / `USDA` | 5 each | 2026-07-18 02:42:17 | same timestamp | instantaneous — synthetic seed batch, not a live API pull |
| `INTELLIGENCE_LIBRARY_SEED` | 80 | 2026-07-20 16:22:03 | 2026-07-20 16:22:04 | 1 sec — Claude-authored narratives, not sourced ingestion |
| `PROPUBLICA_990` | 2 | 2026-07-20 16:22:27 | same | — |

**Only 2 of the 4 rows-#166-169 scripts have ever actually run**: NIH RePORTER and NSF Awards, both on
2026-07-26, overlapping in the same ~3-minute window (06:35:03-06:38:07) — almost certainly two
terminal sessions launched back-to-back or in parallel, not two separate "nights." Commit `0038fca`
(same day) narrates this run and a real bug it found/fixed (`.in()` filter with 500 values exceeded
Supabase's gateway query-string limit — fixed by chunking to groups of 100) — its commit message says
"NIH 2,442 inserted, NSF 306 inserted," undercounting NSF relative to the live table (614); the commit
message is a mid-run or partial snapshot, the DB is ground truth.

**`ingest-federal-register.ts` and `ingest-samhsa-hrsa.ts` have never been executed successfully (or at
all) in this environment.** Zero rows exist under either source label. `FEATURE_REGISTRY_v2.md` rows
#168/#169 say "Script exists, never run at scale" — confirmed accurate, and in fact **never run at any
scale**, not even the single small validation pass NIH/NSF got.

**Row D5's "11 NIH proposals loaded" is stale.** That figure is the old `NIH` seed source
(2026-06-20, pre-dates the real script by weeks) — the real `ingest-nih-reporter.ts` script has since
delivered 2,442 real rows. Row D5 was not updated after the 2026-07-26 run. Flagging this for a future
reconciliation pass; not corrected here since this task is scoping-only.

### Real wall-clock for "Night 1" (as actually run)

**≈3 minutes total**, for the two sources that ran (NIH RePORTER + NSF Awards combined), producing
3,056 real new rows. This is dramatically faster than the roadmap's own estimate for this exact
work ("`ingest-nih-proposals.ts` ... 4-8 hours ... Run After: Night 1", §136) — that estimate describes
a different, larger, keyword-day-of-year cron sweep (`src/lib/intelligence/ingest-nih-proposals.ts`,
10/day, unrelated to the bulk backfill script scoped here), not this one. Do not reuse the roadmap's
4-8 hour figure for this script; it was never about this script.

---

## 3. Real API rate limits per source

**Caveat up front:** `WebSearch` was unavailable in this session (permission not granted), so the
figures below are not freshly re-verified against each provider's current published docs today. They
combine (a) what the real 2026-07-26 run actually demonstrated live, which is hard evidence, and (b)
general knowledge of these four public APIs as of this assistant's training, which is soft evidence and
should be spot-checked before a long unattended run, especially for the two sources that have never
actually been hit.

| Source | Auth | Observed/known limit posture | Confidence |
|---|---|---|---|
| **NIH RePORTER v2** | none | No hard rate limit was hit during the real run — ~5 sequential 500-row POST pages completed in 69 seconds with zero throttling/429s. The one real structural constraint (not a rate limit, a pagination ceiling) is that RePORTER's underlying search index historically rejects `offset` values much past ~14,999 — irrelevant at `MAX_PAGES=20 × 500 = 10,000` but would matter if a future run raised the cap to chase a bigger corpus. | High for "ran clean without throttling"; medium for the offset-ceiling recollection (not re-verified) |
| **NSF Award Search v1** | none | Also ran clean, no throttling — but page size is capped at 25/page by the API itself (not the script's choice), so pulling any meaningful volume means many more requests than NIH for the same row count (614 rows took ~25 pages / 3.1 min ⇒ ~7.4 sec/page, mostly response latency, not enforced delay). No published hard rate limit is coded around in the script (no backoff logic exists). | High for the observed run; medium for "no published limit" |
| **Federal Register API v1** | none | **Never actually run** — nothing to observe. Publicly known to be a low-traffic, generally permissive public API (used by many civic-tech projects without keys), but this project has zero live evidence of its throttling behavior. Script caps at `MAX_PAGES=10 × 100 = 1,000` docs. | Low — no live evidence, general knowledge only |
| **USASpending.gov v2 `spending_by_award`** | none | **Never actually run** — nothing to observe. Known publicly to be a high-volume, generally permissive public API, but this endpoint is explicitly documented upstream as not intended for large bulk extraction (USASpending offers a separate bulk-download API for that) — the script's own `LAST_PAGE=10` cap (hard 1,000-row ceiling) already reflects that constraint by design, not a rate limit workaround. | Low — no live evidence, general knowledge only |

**Net assessment on rate limits specifically: they are not the risk.** All four sources are unauthenticated,
public, no-key REST APIs with generous or self-capped volumes (the scripts themselves cap total pulled
records well below anything that would trigger throttling on APIs of this class). If nights 2-7 were
only "run these same 4 scripts again, maybe with wider date ranges," that portion would safely fit in
minutes, comfortably inside one unattended FORGE prompt. That is not, however, most of what nights 2-7
actually require — see §4.

---

## 4. Why nights 2-7 are not just "run more scripts" — and the real time/volume estimate

Directive 3's 15-source "Funded Proposal Sources" table is the actual corpus target (2,000+ proposals,
currently ~3,056 real + ~110 seed/synthetic rows against that target from NIH+NSF alone — arguably
already close on raw volume, but concentrated in 2 of 15 sources). Reconciling that table against what
exists in `scripts/` today:

| Directive 3 source | Method (per directive) | Script exists? | Notes |
|---|---|---|---|
| NIH RePORTER | REST API | ✅ `ingest-nih-reporter.ts` | Run once, works, fast |
| NSF Award Search | REST API | ✅ `ingest-nsf-awards.ts` | Run once, works, fast |
| Federal Register NOFO | RSS + scraper (directive says scraper; real script is a REST API call) | ✅ `ingest-federal-register.ts` | Built, never run |
| SAMHSA Grant Awards | Web scraper (per directive) | ⚠️ partial — `ingest-samhsa-hrsa.ts` covers this via the USASpending REST API instead, not a scraper | Built, never run |
| HRSA Grant Awards | Web scraper (per directive) | ⚠️ same file as SAMHSA above, same caveat | Built, never run |
| NIH NIAID Sample Applications | Scraper + PDF parser | ❌ no script | Not started |
| HUD CPD Awards | Web scraper | ❌ no script | Not started |
| DOJ OJP Award Database | Web scraper | ❌ no script | Not started |
| University grant libraries (Alaska, UCSB, Georgetown, Wisconsin) | Web scraper | ❌ no script | Not started |
| Community Foundation examples | Web scraper | ❌ no script | Not started |
| Robert Wood Johnson Foundation | Web scraper | ❌ no script | Not started |
| Annie E. Casey Foundation | Web scraper | ❌ no script | Not started |
| W.K. Kellogg Foundation | Web scraper | ❌ no script | Not started |
| Gates Foundation | Web scraper | ❌ no script | Not started |
| Wellcome Trust | Web scraper | ❌ no script | Not started |

**4 of 15 sources have a script at all (rows #166-169). 2 of those 4 have actually been run. 9 of 15
sources have zero code — they don't exist to "run."** Reaching Directive 3's real target requires
writing ~9-11 new scrapers before any of their runtime can even be estimated.

For the **2 fast remaining API scripts** (Federal Register, SAMHSA/HRSA), extrapolating directly from
the observed NIH/NSF run (similar page-count order of magnitude, similarly uncapped-in-practice APIs,
similarly small hard caps coded into each script — `MAX_PAGES=10`/`LAST_PAGE=10`): each should complete
in **under 2 minutes**, combined well under 5 minutes. This part genuinely is safe to run unattended,
today, with the code that already exists.

For the **9-11 not-yet-built scrapers**, this repo already has a governing contract for exactly this
kind of work — `BEHAVIORAL_CONTRACTS.md` §21 (Custom Scraping Contracts), written for the platform's
own scraping features but the same real-world constraints apply to any scraper this project builds:

- **Minimum 5-second delay between requests to the same domain.** For a source like a university grant
  library or a foundation's published-grants page with (per Directive 3's own estimates) 100-200
  target proposals, each likely requiring at least one page load per proposal (list page + detail page,
  realistically 2+ requests per record), that's roughly 200-800 requests × 5 sec = **17-67 minutes of
  enforced delay alone, per source**, before accounting for actual page-load/parse time, retries, or a
  reviewer-guide PDF-parsing step (NIH NIAID's "Scraper + PDF parser" line). Across 9-11 such sources,
  that's **multiple hours of pure rate-limited wall-clock, run serially**, not counting build time.
- **Robots.txt compliance is mandatory** ("if target URL disallows scraping, do not proceed. Notify
  user") — meaning some of these 9-11 sources may turn out to be entirely blocked and need a fallback
  or manual data path decided by a human, not something a fully unattended pipeline can resolve on its
  own.
- **Auto-pause on 3 consecutive zero-result runs** — a real, designed-in signal that a given source's
  page structure doesn't match what the scraper expects, requiring a human to look and reconfigure
  before that source can continue. An unattended multi-hour run that hits this on source #3 of 9 would
  silently stop making progress on that source while burning time elsewhere, with no one watching.
- None of these 9-11 scrapers have been written, so there is no real measured time for the build step
  itself — only the roadmap's original per-night prompt-count estimates (12-18 prompts per code-build
  night, Nights 2 and 5 in the original roadmap most directly overlap this content), which are FORGE
  queue-authoring estimates, not data-run estimates, and have their own independent failure history in
  this repo (`Intelligence Library Night 2` queue run: 10/13 prompts passed, `logic-005` failed and
  halted the chain — per `governance/STATE_OF_THE_BUILD.md` line 239 — real evidence that even the
  code-build side of this roadmap does not reliably complete unattended in one pass).

---

## 5. Verdict

**Not safe to run nights 2-7 as a single long unattended FORGE prompt.** Two independent reasons, either
one sufficient on its own:

1. **The work is not homogeneous.** A few minutes of safe, already-proven, rate-limit-trivial API calls
   (Federal Register, SAMHSA/HRSA — finishable in under 5 minutes right now) sit next to 9-11 completely
   unbuilt scrapers whose own governing contract (§21) mandates human-in-the-loop behavior for exactly
   the failure modes a long unattended run would hit blind: robots.txt blocks, structure-change
   auto-pause, and 5-second-per-domain-enforced multi-hour runtimes. Bundling all of it into one prompt
   either forces the fast part to wait uselessly behind hours of rate-limited scraping, or forces the
   slow, human-supervision-designed part to run exactly the way its own contract says it shouldn't.
2. **This repo has direct, recent precedent for exactly this failure shape** — the soft note this task
   itself references (this morning's soak-test queue-design catch) plus the real `Intelligence Library
   Night 2` FORGE run in this repo's own history, which got 10/13 prompts through before a real failure
   (`logic-005`) halted the chain, leaving 3 downstream prompts (`logic-006`-`logic-008`) never run.
   Multi-hour, multi-source unattended pipelines in this specific codebase have a documented history of
   not finishing cleanly.

**Recommended split:**
- **Session A (minutes, safe today):** run `ingest:federal-register` and `ingest:samhsa-hrsa` as-is —
  no new code needed, low risk, closes out rows #166-169 fully. Confirm real row counts land under the
  `FEDERAL_REGISTER`/`USASPENDING` source labels afterward, the same way this document verified NIH/NSF.
- **Session(s) B+ (one new scraper source per session, matching Directive 3's own "one component per CC
  session" discipline already in use for UI work):** build and run each of the 9-11 remaining scraper
  sources individually, with a real robots.txt/structure check and a real observed run before moving to
  the next — not a single queue chaining all of them.
- Update row D5 and rows #168/#169 to reflect real current state (Federal Register/SAMHSA-HRSA scripts
  exist but have never produced a row) once Session A actually runs — out of scope for this document.
