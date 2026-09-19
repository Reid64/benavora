# AR-17.3 — Research & Discovery family: provenance audit and fabrication spot-check

**Date:** 2026-09-19
**Scope:** every agent that discovers, enriches, extracts or researches — donor
discovery, funder enrichment, the knowledge indexer, corporate prospect agents,
the XML/990 enrichment path, contact extraction, eligibility-criteria extraction.
**Method:** `scripts/audit/output-quality-sampler.mjs` (AR-17.1, read-only)
driven by `test-evidence/research-family-deep-dive.mjs`, plus three companion
probes built for this prompt. All are READ-ONLY: GET-only against PostgREST,
no Claude calls, no agent execution, no writes.
**Verdicts only. No fixes. AR-17.6 fixes.**

---

## LEAD FINDING — the thing to read if you read nothing else

**No claim in this family was contradicted by its own source, because on this
platform no source is stored to contradict it.**

The `opportunities` table holds 6,309 filled actionable fields (deadline,
grant range, eligibility, application method, required documents, geographic
restrictions, description) across 4,860 rows. 6,211 of those fields — **98.4%** —
sit on a row that carries a `url`. That 98.4% is the number that looks like
provenance, and it is not provenance. It is *pointer* coverage.

**The proportion of enriched funder fields backed by a stored source is 0.0%
(0 of 6,309).** `opportunity_documents`, the only column that could hold
retained source material, is populated on 174 rows and contains exclusively
`[{"url": ..., "title": ...}]` — attachment *links*, never attachment *text*
(verified across the 10 most recent rows that have it; `docHoldsSourceText`
false on all 10, raw evidence in `ar173-spotcheck-deep-raw.json`).

The consequence is precise and worth stating plainly: **a fabricated deadline
and a correctly-scraped deadline are, today, indistinguishable after the fact.**
Both are a bare value next to a link to a live page that may since have changed.
Nothing was retained at write time against which either could be checked. The
fabrication failure mode this prompt was written to detect is currently
*undetectable by construction* — which is a worse position than finding
fabrication, because it means we cannot say it is absent.

**Contradicted count from the spot-check: 0 — of 10 claims, 0 were checkable.**
See §3 for why that zero is not reassurance.

---

## 1. Sampler results — the family

33 registry entries assessed, 21 `ASSESSED`, 12 `INSUFFICIENT_SAMPLE`.
Raw: `test-evidence/research-family-sampler-raw.json`.

### 1a. Corporate prospect enrichment squad (EA-01 … EA-10)

All ten read `corporate_prospects.enrichment` (jsonb), n=50, newest write
2026-09-19T11:45:55Z.

| Agent | Field | distinct | nullity | grounding |
|---|---|---|---|---|
| ea01_giving_detector | has_giving_program | 1 | **100%** | not configured |
| ea02_community_outreach_detector | community_involvement | 3 | 98% | not configured |
| ea03_sponsorship_detector | sponsorship_activity | 1 | **100%** | not configured |
| ea04_foundation_detector | foundation_affiliation | 2 | 98% | **2%** (1/50 has foundation_ein) |
| ea05_career_page_analyzer | company_culture_signals | 1 | **100%** | not configured |
| ea06_press_release_analyzer | donation_history | 3 | 98% | not configured |
| ea07_esg_analyzer | esg_initiatives | 1 | **100%** | not configured |
| ea08_executive_biography_analyzer | decision_maker_names | 2 | **100%** | not configured |
| ea09_contact_extractor | verified_emails | 1 | **100%** | not configured |
| ea10_social_media_analyzer | recent_donations | 2 | **100%** | not configured |

Six of ten are 100% empty. This corroborates the AR-17.1 / Phase-5 finding that
the EA-01..10 pipeline is dead and starves `ag-22-propensity` downstream.

**But note the direction of the failure: these agents write nothing rather than
writing something invented.** `enrichment` on a real prospect
(`GOOD HOUSING CONSTRUCTION LLC`) reads `recent_gifts: []`, `board_members: []`,
`foundation_affiliation: null`, `decision_maker_names: []` — empty arrays, not
plausible guesses. On the fabrication axis specifically, this squad is clean.
It is useless, not dishonest. Those are different defects and AR-17.6 should
not conflate them.

### 1b. Opportunity-writing research agents

| Agent | Column | n_total | distinct | nullity | url-pointer rate |
|---|---|---|---|---|---|
| foundation_research | description | 4,860 | 22 | **93.0%** | 100% |
| local_sponsorship | description | 4,860 | 22 | **93.0%** | 100% |
| government_research | description | 4,860 | 22 | **93.0%** | 100% |
| custom_api_research | description | 4,860 | 22 | **93.0%** | not configured |
| custom_scrape_research | description | 4,860 | 22 | **93.0%** | 100% |
| government_research_housing_scrapers | description | 4,860 | 22 | **93.0%** | 100% |
| government_research_nofa_parser | description | 4,860 | 23 | **92.7%** | **0%** (evidence col = `opportunity_documents`) |
| grants_gov_research | description | 341 | 72 | 30.0% | 100% |
| hud_monitor | description | 87 | 33 | 1.1% | 90.8% |
| state_portal / _housing_scrapers | description | 257 | 121 | 0% | 100% |
| sam_gov_research | deadline | 100 | 24 | 0% | 100% |
| corporate_research | description | 5 | 5 | 0% | 80% |

Seven entries above report the identical 4,860 / 93.0% figures because their
registry `agentFilter` does not discriminate — they are all reading the whole
`opportunities` table, not their own output. That is a **registry defect, not
seven identical agents**: the per-agent numbers in those rows should be read as
"whole-table baseline", and AR-17.6 must fix the filters before any of those
seven can be judged individually. Flagging this rather than reporting seven
confident-looking duplicate rows as seven findings.

`government_research_nofa_parser` at **0% grounding** is real and not a filter
artifact: its configured evidence column is `opportunity_documents`, which is
null on 4,686 of 4,860 rows.

### 1c. Insufficient sample (n below threshold)

`foundation_research_finder` (0), `simpler_grants_research` (0),
`state_portal_tdhca` (0), `government_research_usaspending` (0),
`competitor_intelligence` (0), `funder_intel` (2),
`giving_history_extractor` (2), `cold_outreach` (4),
`ag-29-knowledge-indexer` (4).

Four of these are **structurally zero, not merely unsampled**:
`state_portal_tdhca` (`source=eq.tdhca.state.tx.us` returns `[]`) and
`government_research_usaspending` (`historical_awards` count 0) have produced
no row ever. `cold_outreach`'s four rows are all
`"EXERCISE-HARNESS Fixture Co"` — harness fixtures from the AR-15 exercise run,
not customer-facing output. Counting those four as production output would be a
reporting error; they are excluded from every rate in this document.

### 1d. Two registry corrections confirmed live during this pass

Carried from `research-family-deep-dive.mjs`, both verified against live data,
both left unpatched per this prompt's no-fixes scope:

- `state_portal.primaryColumn = "eligibility"` names a column that does not
  exist on `opportunities` (real columns: `eligibility_requirements`,
  `eligibility_score`). `state-portal.ts` never writes
  `eligibility_requirements`; it folds scraped eligibility text into
  `description` as an `"Eligibility: ..."` substring. Un-corrected, this entry
  returns HTTP 400.
- `sam_gov_research.agentFilter = "source=eq.sam.gov"` matches **zero** rows;
  the value actually written is `sam_gov` (underscore). Confirmed live:
  `source=eq.sam.gov` count 0, `source=eq.sam_gov` 100 rows. Un-corrected, this
  reports a false `INSUFFICIENT_SAMPLE`.

---

## 2. PROVENANCE — per-field, stored source vs. none

Live counts over all 4,860 `opportunities` rows.

| Field | Filled | With `url` pointer | Pointer rate | **With stored source** |
|---|---|---|---|---|
| deadline | 3,592 | 3,568 | 99.3% | **0** |
| description | 1,269 | 1,251 | 98.6% | **0** |
| eligibility_requirements | 467 | 463 | 99.1% | **0** |
| amount_min | 271 | 256 | 94.5% | **0** |
| amount_available | 268 | 258 | 96.3% | **0** |
| amount_max | 240 | 225 | 93.8% | **0** |
| geographic_restrictions | 131 | 127 | 96.9% | **0** |
| application_method | 46 | 42 | 91.3% | **0** |
| required_documents | 25 | 21 | 84.0% | **0** |
| **TOTAL** | **6,309** | **6,211** | **98.4%** | **0 (0.0%)** |

**Rows with no source pointer at all: 39.** Of those, **24 carry a deadline** and
**4 carry eligibility text** — actionable claims with neither a stored source
nor even a link. These are the highest-risk rows on the platform and should be
AR-17.6's first target.

**Other stores in this family:**

- `corporate_prospects`: 50 rows, 50 enriched, **49 carry `source_adapters`**
  (98%). This is the family's best provenance discipline — `source_adapters:
  ["sam_gov"]` names which adapter produced the enrichment. Still a *pointer*
  (an adapter name, not retained text), but it is attributable, which the
  `opportunities` path is not.
- `funder_intelligence`: 2 rows, **2 carry `raw_data`** (100%) — and
  `raw_data.pageText` is **the only retained source text anywhere in this
  family.** n=2.

---

## 3. FABRICATION SPOT-CHECK

### 3a. Selection rule (fixed before looking at any content)

The 10 most recently `discovered_at` rows in `opportunities` carrying at least
one actionable claim (`deadline`, `amount_*`, `eligibility_requirements`, or
`application_method`). No quality filter. The prompt's instruction not to sample
only records that look good is enforced structurally: the query orders by
recency and cannot see content. Script: `ar173-fabrication-spotcheck.mjs`.

### 3b. Result

| Verdict | Count |
|---|---|
| Matched against stored source | **0** |
| **Contradicted by stored source** | **0** |
| Unverifiable — pointer only, no stored source | **10** |
| Unverifiable — no source at all | 0 |
| **Total claims examined** | **10** |

All 10 drew `deadline`; 9 of 10 from `source=grants_gov`, 1 from `source=agent`.
Every one had a `url` and no stored source.

**Read the zero correctly.** 0 contradicted does not mean 0 fabricated. It means
the check could not run. Of 10 claims, 10 were unverifiable. The honest summary
of this spot-check is *"no verification was possible,"* not *"verification
passed."* Reporting this as a clean bill of health would be exactly the kind of
confident-looking-but-groundless claim this audit exists to find.

### 3c. The one real stored-source comparison available

`funder_intelligence.raw_data.pageText` is the only retained source text in the
family. Both rows checked in full:

| Row | Stored source | Extracted claims | Verdict |
|---|---|---|---|
| `70980989…` (2026-09-19) | `pageText: ""` (empty) | priorities `[]`, recent_grants `[]`, board_members `[]`, review_criteria `null`, average_grant_size `null`, total_annual_giving `null` | **Honest** — nothing claimed from nothing |
| `7676da57…` (2026-08-23) | Walmart.com **retail homepage** (~2.5 KB of "Save 10¢/gallon", "Gaming Monitor", "Body Oil") | priorities `[]`, recent_grants `[]`, board_members `[]`, average_grant_size `null`, total_annual_giving `null` | **Honest** — 0 contradicted |

The second row is the sharpest test the platform can currently offer: an
extraction agent handed a page with no funder information whatsoever. It invented
**nothing**. Given a shopping page, it did not hallucinate a grant range or a
program officer — it returned empty fields and stored the page it read.

That is the correct behaviour, and it is the strongest evidence in this report
that the *extraction* logic is not a fabricator. It is also a sample of two, one
of which is an empty string, so it cannot carry the platform-wide conclusion. It
does tell us the targeting is wrong — scraping walmart.com as "funder
intelligence" wastes the call regardless of how honestly it reports.

### 3d. Internal-consistency checks (run because stored-source checks could not be)

Since claims cannot be checked against sources, they were checked against each
other and against reality. Over the full table, or the first 1,000 rows where
noted:

| Check | Result | Reading |
|---|---|---|
| `amount_min > amount_max` | **0** of 190 pairs | Clean. No self-contradicting ranges. |
| Deadline present | 3,592 of 4,860 | — |
| **`status='open'` with deadline in the past** | **1,090** | **22.4% of the table.** Not fabrication — staleness. A customer filtering for open opportunities sees 1,090 expired ones. |
| Deadline ≥ 2029-01-01 | 170 | Implausible-but-not-impossible (NIH multi-year RFAs legitimately run to 2030). Not counted as fabrication; flagged for AR-17.6 sampling. |
| `description` is a bare URL | **42**, all `sam_gov` | The field does not contain what its name promises — it holds `https://api.sam.gov/.../noticedesc?noticeid=…`. Structural defect, not invention. |
| Eligibility text that explicitly hedges | **46** of 467 (9.9%) | See §4 — this is the *good* pattern. |

---

## 4. COVERAGE HONESTY — null vs. plausible guess

**The family passes this test, and one agent sets the standard.**

`ca_grants_portal` (200 of 467 eligibility strings, the largest single source)
writes, verbatim:

> `Agency: Governor's Office of Emergency Services Nonprofit eligibility not
> confirmed from source data — verify on the funder's page before applying.`

and, when it *can* confirm:

> `Agency: Department of Financial Protection and Innovation Nonprofit
> organizations confirmed eligible (California Grants Portal applicant-type tag).`

This is exactly right: it distinguishes determined from undetermined, names the
authority for the determination, and tells the customer what to do about the gap.
**AR-17.6 should treat this string as the template for the rest of the family.**

Evidence of the same discipline elsewhere:

- `corporate_prospects.enrichment` — empty arrays (`[]`) and explicit `null`,
  never a plausible-looking placeholder, across all 50 rows.
- `funder_intelligence` — empty extraction from an irrelevant page (§3c).
- `hud_monitor` — of 87 rows, one has a null description and several have null
  deadline/amount rather than an invented one; nullity 1.1% with 33 distinct
  values means it is writing real varied text where it has it.
- The 93% description-nullity across the opportunity writers is, on this axis,
  a *point in their favour*: they are leaving the field empty rather than
  generating filler.

**No instance of a fabricated-looking fill was found in this family.** Fields
that could not be determined were left null. The single counter-pattern is
structural, not inventive: `sam_gov`'s 42 rows put a URL in `description`, which
misrepresents the field's contents without inventing a fact.

**Net:** this family's live defect is **unverifiability and staleness**, not
invention. The customer-facing risk in the prompt's framing — "acts on an
invented deadline" — is not presently evidenced. The risk that *is* evidenced is
"acts on a real-but-expired deadline" (1,090 rows) and "cannot check anything
after the fact" (6,309 fields).

---

## 5. `ag-29-knowledge-indexer` — its own section

### 5a. The prompt's figures, verified live — both are wrong

| Figure | Prompt | **Live (2026-09-19)** |
|---|---|---|
| Lifetime runs | ~63,941 | **65,602** |
| Share of all `agent_runs` | ~44% | **95.94%** (65,602 / 68,377) |
| Runs processing zero items | "every one" | **64,695 of 65,602 (98.6%) — not all** |

The share is not 44%. **ag-29 is 96% of every agent run ever recorded on this
platform.** The prompt understated it by more than a factor of two. This
supersedes the earlier 85% figure on record; the number is still climbing
because the agent is still running (2,134 runs in the last 24 hours, one roughly
every 40 seconds).

Corrected breakdown:

| | Count |
|---|---|
| Total ag-29 runs | 65,602 |
| status `completed` | 65,601 |
| status `failed` | **0** |
| status `running` | 1 |
| Found rows but embedded **zero** | **42,515** |
| Found zero rows | 22,180 |
| **Embedded ≥ 1 row** | **907** |
| Runs recording `tokens_used > 0` | **0** |
| First run ever | 2026-08-03T08:23Z |

### 5b. Q1 — What does it believe it is iterating over?

Read from source, not inferred. `src/lib/agents/knowledge-indexer-agent.ts`
scans three tables for rows `WHERE embedding IS NULL`:

- `intelligence_proposal_sections` (lines 413–417)
- `outcomes` (lines 427–431)
- `foundation_directory` (lines 448–452)

batched at `EMBEDDING_BATCH_SIZE` (100), embedding the first chunk of each row
via `generateEmbeddingsBatch()` and writing it back (lines 657–669).

### 5c. Q2 — Why is that set empty?

**It is not empty. That premise is false, and this is the most important
correction in this section.**

| Table | Total rows | Still unembedded |
|---|---|---|
| `intelligence_proposal_sections` | 105 | **0** — complete |
| `outcomes` | 7 | 1 |
| `foundation_directory` | **133,812** | **43,061** |

There are **43,062 rows of genuine, queued, correctly-scoped work** waiting
right now. The agent's target set is one of the largest in the database.

The real historical failure was **not an empty set — it was the embedding call
failing**: 42,515 runs *found* rows (`items_found > 0`) and embedded *none*
(`items_processed = 0`). That is the signature the code itself documents at
lines 645–652 — whole-batch failure after retries, most commonly a
missing/invalid `OPENAI_API_KEY` — with every such run still reported
`status='completed'`. `tokens_used > 0` on **zero** runs is consistent with that:
no embedding call ever succeeded through that period.

**And it is working now.** The 907 productive runs are *all* within the last 24
hours. The last 8 runs read `Embedded 100/100 row(s) (0 failed); pattern
aggregation not due.` The first productive run was 2026-09-15 (2 items); real
throughput began 2026-09-19. The AR-14.1 / AR-15.1 / Phase-5.1 repairs appear to
have landed and the credential now works.

### 5d. Q3 — Fix or delete?

**FIX. Do not delete.** AR-15 owns the deletion; this prompt's verdict is that it
must not be exercised.

The case for deletion rested on "63,941 runs over an empty set." Both halves are
false: the set holds 43,061 real rows, and the agent is currently embedding them
at 100/run with a 0% failure rate. Deleting it would discard the only component
that populates embeddings for `foundation_directory`, and would strand the
semantic-search and pattern-aggregation features built on top of it. It is
roughly 32% of the way through its corpus and moving.

**What must be fixed instead is its run accounting, which is the actual
platform-level defect:**

1. **It writes an `agent_runs` row every ~40 seconds regardless of outcome.**
   This is what makes ag-29 96% of the table and makes `agent_runs` useless as a
   denominator for cost, health, or success-rate reporting anywhere on the
   platform. Every agent metric computed over `agent_runs` is currently
   dominated by an agent that makes no Anthropic calls.
2. **42,515 failed batches were recorded `status='completed'`.** Migration 199's
   `'skipped'` status and the `batchLevelFailure` logic (lines 683–698) address
   this going forward, but the 42,515 historical rows still read as successes
   and will keep poisoning any retrospective analysis.
3. **The cadence is wrong for the work.** At ~2,134 runs/day yielding 907
   productive ones, the 43,061 remaining rows need ~431 productive runs. The
   polling interval should back off when `items_found = 0` rather than burning a
   run row every 40 seconds.

**Recommended AR-17.6 / AR-15 disposition:** keep the agent, fix the accounting,
back off the poll, and either backfill-correct or explicitly exclude the 42,515
mislabelled historical rows from all reporting.

---

## 6. Summary of verdicts

| # | Finding | Severity |
|---|---|---|
| 1 | **0.0% of 6,309 enriched funder fields carry a stored source.** 98.4% carry a URL pointer, which cannot verify a claim after the fact. Fabrication is currently undetectable by construction. | **Critical** |
| 2 | **ag-29 is 95.94% of all `agent_runs`** (65,602/68,377), not the ~44% assumed. `agent_runs` is unusable as a denominator platform-wide. | **Critical** |
| 3 | ag-29's target set is **not empty** — 43,061 unembedded `foundation_directory` rows. Verdict: **fix, do not delete.** It is embedding 100/100 as of today. | **High (corrects premise)** |
| 4 | 42,515 ag-29 runs recorded `completed` while embedding zero of the rows they found. | **High** |
| 5 | **1,090 rows (22.4%) are `status='open'` with a past deadline.** The evidenced customer-facing risk is staleness, not invention. | **High** |
| 6 | 39 rows have no source pointer at all; **24 of them carry a deadline**, 4 carry eligibility text. | **High** |
| 7 | Seven registry entries share an undiscriminating `agentFilter` and all report the same whole-table 4,860/93.0% baseline. Not seven findings — one registry defect. | **Medium** |
| 8 | 6 of 10 EA-01..10 enrichment fields are 100% null; `ea04` grounding 2%. Dead pipeline, but **empty, not invented**. | **Medium** |
| 9 | `state_portal.primaryColumn` and `sam_gov_research.agentFilter` are both wrong in the AR-17.1 registry (confirmed live). | **Medium** |
| 10 | 42 `sam_gov` rows store a bare URL in `description`. | **Medium** |
| 11 | **Coverage honesty passes.** No fabricated fill found. `ca_grants_portal`'s hedged eligibility string is the template the family should adopt. | **Positive** |

---

## Evidence index

| File | Contents |
|---|---|
| `research-family-sampler-raw.json` | Full AR-17.1 sampler output, 33 entries |
| `research-family-deep-dive.mjs` | Family target list + 2 registry corrections |
| `ar173-provenance-and-ag29.mjs` / `ar173-provenance-raw.json` | Live ag-29 counts, per-field provenance |
| `ar173-ag29-timeline.mjs` | ag-29 productivity timeline, remaining corpus |
| `ar173-fabrication-spotcheck.mjs` / `ar173-spotcheck-raw.json` | 10-record spot-check, recency-selected |
| `ar173-spotcheck-deep.mjs` / `ar173-spotcheck-deep-raw.json` | Stored-source shape, consistency checks |
| `fabrication-candidates-raw.txt` | Verbatim rows per source |
| `corporate-prospects-sample.json` | EA-01..10 enrichment payloads |
| `funder-intel-and-outreach-sample.txt` | `funder_intelligence` + `outreach_contacts` |

All probes read-only. No agent was executed, no Claude call made, no row written.
