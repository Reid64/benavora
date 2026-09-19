# AR-17.2 — Output-Quality Assessment: the Scoring Family

Read-only assessment of every agent in the codebase that emits a score, probability,
rank, match strength, or confidence value, run against live production data on
2026-09-19. Tooling: `scripts/audit/output-quality-sampler.mjs` (AR-17.1) plus a new
read-only companion, `scripts/audit/scoring-family-deep-dive.mjs`, built for this
pass — see "Why a second tool" below. Both are GET-only against PostgREST; neither
calls Claude or executes an agent. Raw JSON for every agent below is saved at
`test-evidence/scoring-family-deep-dive-raw.json` and (for the agents AR-17.1
already covered) `test-evidence/AGENT_CENSUS.md` / the AR-17.1 report.

No fixes were made in this pass. This is a diagnosis, not a repair — AR-17.5 fixes.

## Headline findings (most serious first)

1. **`opportunity_probability_scores` (agent `ag-15-probability`) is DEGENERATE for
   95.6% of sampled rows, and the cause is a hardcoded formula, not an LLM.** Two
   different writers share this table by upserting on `(opportunity_id,
   organization_id)`: a real Claude-backed agent
   (`src/lib/agents/probability-scoring-agent.ts`), and a purely arithmetic
   "deterministic precursor" (`src/lib/intelligence/grant-probability-engine.ts`,
   self-documented at its own file header as "Deterministic (non-Claude)"). Of 500
   sampled rows, 478 (95.6%) have **all three** of the formula's non-Digital-Twin
   factors pinned to hardcoded fallback constants simultaneously: `eligibility_score`
   → `NEUTRAL_ELIGIBILITY = 0.5` (30% weight), `category_win_rate` →
   `NEUTRAL_CATEGORY_WIN_RATE = 0.3` (25% weight), `deadline_proximity` → `0` (20%
   weight). That is 75 of the 100 weighted points frozen at constants on every one
   of those rows — `src/lib/intelligence/grant-probability-engine.ts:18-20,175-199`.
   The only factor that ever varies is `twin_completeness` (25% weight), so the
   entire visible spread in this "probability" (25, 40, 38, 35, ...) is a linear
   echo of one number (the org's Digital Twin completeness score) plus three fixed
   constants. This number is shown to customers on the live opportunities list as a
   green/amber/red **"Probability"** badge with an expandable **Key Risks / Key
   Strengths** panel (`src/app/(dashboard)/opportunities/page.tsx:265-303,1044-1168`)
   — the risks/strengths shown alongside the frozen-formula rows are themselves
   templated strings (`"No eligibility score computed for this opportunity yet."`,
   `"No prior outcomes recorded in this funding category."`, verified verbatim in
   production rows) built by `buildKeyRisks`/`buildKeyStrengths` in the same file
   (:211-256+), not synthesized per-opportunity reasoning. **This is a constant
   score, wrapped in templated "risk" language, presented to the customer as a
   personalized per-opportunity assessment.** Full trace in the `ag-15-probability`
   section below.

2. **The entire PIL qualification/knowledge/relationship/strategy/application
   scoring squad has never scored a real prospect.** `pil_agent_runs` has 122
   lifetime rows platform-wide, but for every scoring-bearing PIL agent examined
   (`BEN-QLF-01..05`, `BEN-KNW-01/02/03`, `BEN-REL-04`, `BEN-STR-02`, `BEN-APP-01`,
   `BEN-APP-02`, `BEN-SUP-04`) total lifetime row counts are 1–7, virtually all
   tagged `"goal": "EXERCISE-HARNESS exercise run for <agent>"` against the
   synthetic `EXERCISE-HARNESS-Test Foundation` organization, and most short-circuit
   with `{"skipped": true, "reason": "<AGENT> requires an existing prospectId"}`
   before any score is computed at all. These are not low-volume-but-real agents —
   they are effectively **never-run**. No verdict of USEFUL/THIN/WRONG/DEGENERATE
   applies to a score that has not yet been computed against a real customer input;
   all are marked INSUFFICIENT SAMPLE below, but the platform-wide takeaway is that
   the "qualification squad" the task names does not currently qualify anyone.

3. **`corporate_intent_signals.intent_score` (agent `ag-30-donor-intent`) has zero
   rows, ever**, despite a live dashboard page
   (`src/app/(dashboard)/donor-discovery/intent-signals/page.tsx`) built to render it
   as a large colored number with a "high intent" threshold stat. The UI exists; the
   data has never once been written.

4. **`submission_queue.risk_score` (agent `autoapply_risk_engine`) has 8 lifetime
   rows and every single one is a synthetic `AUTOAPPLY_RISK_TEST_FUNDER_*` test
   fixture**, not a real funder. All 8 carry the identical score 95 — real, but
   never yet exercised on a real submission. This score gates whether an AutoApply
   submission is routed to full automation or held for manual review
   (`src/components/autoapply/ManualQueue.tsx:103-109`); the gate has never been
   tested against production traffic.

## Why a second tool

AR-17.1's `output-quality-sampler.mjs` and its `OUTPUT_LOCATIONS` registry point
several PIL agents at a whole nested report object (e.g. `output.report`) rather
than the specific score field inside it. That is fine for a first-pass nullity/
staleness check, but useless for variance: two different qualification reports
almost never serialize identically even when their *score field* is constant,
because the surrounding fields (evidence refs, confidence prose, timestamps) differ.
`scripts/audit/scoring-family-deep-dive.mjs` re-targets every scoring agent at its
real score field (confirmed against source, cited per entry below) and, for
agents whose scores live inside a per-run array (one run can score N candidates —
`BEN-APP-01`, `BEN-APP-02`, `BEN-KNW-02`, `BEN-SUP-04`), flattens across the array
before computing variance/nullity/grounding. It reuses AR-17.1's pure measurement
functions (`computeVariance`, `computeNullity`, `computeBoilerplate`,
`computeGrounding`, `computeStaleness`) unchanged. `OUTPUT_LOCATIONS` itself was not
modified.

No tenancy-scoped cache was found anywhere in this family (each agent either calls
Claude per-item or computes a formula from a DB read scoped by `organization_id`/
`org_id` in every query inspected); the "one org's result served to every org"
failure mode was checked for and not found.

---

## A. Customer-facing headline scores

### `eligibility_scoring` — src/lib/agents/eligibility-scorer.ts

**Contract** (own header, :45 and :242-256): sets `opportunities.{eligibility_score,
recommendation, recommendation_reasoning, match_percentage, is_high_priority,
match_mismatch_reasons}` from a single Claude call per opportunity — "match badge,
default list sort, and high-priority flag read from it." Prompt rubric (:252):
`0-100` where `80-100 strong match (apply); 60-79 moderate (review); 40-59 weak
(skip unless strategic); 0-39 poor (skip)`. `match_percentage` is set to the exact
same integer as `eligibility_score` (:182) — the "% Match" badge is not a second,
independently-computed number.

**n = 902** total rows with a score set; sampled the 500 most recent.
Date range: 2026-06-10 → 2026-09-19 (today).

**Full distribution (top 15 of 19 distinct values, n=500):**

| eligibility_score | count | share |
|---:|---:|---:|
| 2  | 197 | 39.4% |
| 8  | 67  | 13.4% |
| 4  | 66  | 13.2% |
| 22 | 45  | 9.0%  |
| 12 | 28  | 5.6%  |
| 18 | 20  | 4.0%  |
| 52 | 14  | 2.8%  |
| 5  | 14  | 2.8%  |
| 42 | 13  | 2.6%  |
| 45 | 13  | 2.6%  |
| 35 | 5   | 1.0%  |
| 62 | 4   | 0.8%  |
| 32 | 3   | 0.6%  |
| (7 more values) | 11 | 2.2% |

Nullity: 0.0%. Grounding: `recommendation_reasoning` non-empty on 500/500 (100%) —
every row does carry a real, per-opportunity reasoning paragraph.

**Verdict: THIN.** Not DEGENERATE by this audit's bar (no single value dominates
>90%, and the reasoning text genuinely differs per row — verified against 5
consecutive rows: distinct opportunity names, distinct specific complaints). But
the *numeric* resolution is far coarser than the qualitative one: 902 rows collapse
onto 19 distinct integers, and one organization (`FAITH Foundation`,
`b1ab7402-...`, 877 of the sampled 902 rows) supplies almost the entire sample —
scoring hundreds of genuinely different federal grants (oral-health research,
tribal-college capacity building, DOD research collaboration, Alaska land-claims
remediation, city EDA planning grants) at the exact integer 2 for 306/877 (34.9%)
of its own rows, exact 8 for 107, exact 22 for 100, exact 4 for 97. The qualitative
verdict ("poor fit, skip") is correct for a faith-based nonprofit being matched
against federal research/tribal/defense/environmental programs it cannot legally
receive — but a Claude model asked for a `0-100` integer across genuinely distinct
inputs should not collapse onto ~6 specific low integers this hard. No single
code line explains this (parse failure here throws rather than defaulting —
:363-374 — so this is not the "default on error path" mechanism); it is most
consistent with the documented LLM behavior of clustering onto a handful of
"typical low numbers" when a prompt gives coarse rubric buckets (:252) with no
within-bucket calibration anchor. Flagged for 17.5 as a prompt-calibration
candidate, not a code defect with a single fix line. A synthetic exercise-harness
org (`EXERCISE-HARNESS-Test Foundation`) also appears in this table (19/902 rows,
2%) — immaterial to the distribution above, called out for completeness.

**UI:** Fully rendered. `OpportunityCard.tsx:38-73` / `OpportunityTable.tsx:293-307`
→ `MatchBadge` ("NN% match", green>50/yellow>0/red≤0) + `HighPriorityBadge`
(threshold 80) + `EligibilityBar` (green≥80/yellow≥60/red<60).
`OpportunityDetail.tsx:1059-1133` (Eligibility tab) shows all six fields with copy
("Flagged high priority — the agent scored this a strong match (80% or higher)"),
mismatch reasons below 40, and a recommendation badge. `opportunities/page.tsx:
917-919` shows "Eligibility {score}%" inline.

---

### `ag-15-probability` — src/lib/agents/probability-scoring-agent.ts + src/lib/intelligence/grant-probability-engine.ts

**Contract:** two writers upsert the same table.
`probability-scoring-agent.ts` (:902-919) is a real Claude call producing
`{overall_score, confidence, factors, key_risks, key_strengths}`.
`grant-probability-engine.ts` (:1-20) is, in its own words, a "Deterministic
(non-Claude) precursor to the full AG-15 agent: computes a weighted 0-100
probability score from opportunity + Digital Twin + outcomes data alone" —
`eligibility_score 30% / category_win_rate 25% / deadline_proximity 20% /
twin_completeness 25%`.

**n = 1,015** total rows; sampled the 500 most recent.
Date range: 2026-07-18 → 2026-09-19 (today).

**Full distribution (top 13 of 18 distinct values, n=500):**

| overall_score | count | share |
|---:|---:|---:|
| 25 | 322 | 64.4% |
| 40 | 68  | 13.6% |
| 38 | 47  | 9.4%  |
| 35 | 45  | 9.0%  |
| 22 | 3   | 0.6%  |
| 19 | 2   | 0.4%  |
| 15 | 2   | 0.4%  |
| 17 | 1   | 0.2%  |
| 26 | 1   | 0.2%  |
| 18 | 1   | 0.2%  |
| 41 | 1   | 0.2%  |
| 20 | 1   | 0.2%  |
| 23 | 1   | 0.2%  |
| (5 more values) | 5 | 1.0% |

Nullity: 0.0%. Grounding: `factors`/`key_risks`/`key_strengths` non-empty on
500/500 (100%) — every row has *some* content in those fields; the content itself
is the problem (see mechanism).

**Verdict: DEGENERATE. Mechanism traced.** Pulled `factors` for all 500 sampled
rows directly: **478/500 (95.6%)** have `eligibility_score.value === 0.5` (the
literal `NEUTRAL_ELIGIBILITY` constant, `grant-probability-engine.ts:18`),
`category_win_rate.value === 0.3` (`NEUTRAL_CATEGORY_WIN_RATE`, :19), **and**
`deadline_proximity.value === 0` (the "no deadline / deadline passed" branch,
`scoreDeadlineProximity`, :190-199) — all three simultaneously, on the same row.
`scoreEligibility` (:175-178) falls back to the neutral constant whenever
`opportunity.eligibility_score` is `null` at read time; `scoreCategoryWinRate`
(:180-188) falls back whenever the org has zero `outcomes` rows for that funder
category; `scoreDeadlineProximity` returns exactly `0` whenever there is no
deadline on file or it has already passed. With those three pinned, the formula
reduces to `score = round(15 + 7.5 + 0 + 25 × twin_completeness_value)`, i.e. a
linear rescaling of one single number (the org's `organizational_digital_twins.
twin_completeness_score`) into the range `[22.5, 47.5]` — which is exactly the
narrow band the distribution above shows (18–41, rounding). Verified: sampled
rows with `overall_score = 25` have `twin_completeness` factor value `0.1`;
rows with `overall_score = 40` have `twin_completeness` value `0.7`; every other
factor identical across both. Two of five spot-checked score=25 rows also carry
the literal boilerplate risk strings `"No eligibility score computed for this
opportunity yet."` / `"No prior outcomes recorded in this funding category."`
from `buildKeyRisks` (:211-256), confirming these are the deterministic-engine
rows, not the Claude-agent rows. The ~36% of rows with rich, opportunity-specific
risk prose ("Severe mission misalignment: Impact Aid construction grants target
LEAs...") are the genuine `probability-scoring-agent.ts` Claude output — meaning
for the majority of opportunities, the number and risk/strength text customers
see was never touched by the sophisticated agent at all.

**UI:** Fully rendered, prominently. `opportunities/page.tsx:265-303` →
`ProbabilityBadge` ("Probability" column, green≥70/amber≥40/red<40,
`OpportunityTable.tsx:59-70`) plus an expandable `ProbabilityBreakdown`
(`opportunities/page.tsx:1044-1168`) showing the recommendation badge, confidence,
per-factor weight bars, and the Key Risks/Key Strengths lists — i.e. customers see
the frozen-constant factor bars and templated risk copy as if they were a
computed, personalized assessment.

---

### `ag-29-fundability` — src/lib/agents/fundability-scorer-agent.ts

**Contract:** `fundability_scores.overall_score` = `clampScore(raw.overall_score, 0)`
from a dedicated Claude call (`buildScoringPrompt`, using the org's Digital Twin,
KB categories, financial-docs status, and — as context only — the existing AG-15
score, :488). A second Claude call optionally computes `probability_with_fixes`.
Verified this is an independent computation, not a copy of AG-15's score (traced
:896-978): `existingScore` is only interpolated into the prompt text, not
assigned to the output.

**n = 40** total rows (org-scoped table). Date range: 2026-09-16 → 2026-09-19
(today) — a 3-day-old table.

**Full distribution (9 distinct values, n=40):**

| overall_score | count | share |
|---:|---:|---:|
| 2  | 12 | 30.0% |
| 4  | 8  | 20.0% |
| 8  | 5  | 12.5% |
| 22 | 5  | 12.5% |
| 18 | 3  | 7.5%  |
| 12 | 3  | 7.5%  |
| 28 | 2  | 5.0%  |
| 52 | 1  | 2.5%  |
| 5  | 1  | 2.5%  |

Nullity: 0.0%. Grounding: `deficiencies` non-empty on 40/40 (100%).

**Verdict: THIN, same shape as `eligibility_scoring`, small sample.** Every value
in this table is also a value in `eligibility_scoring`'s table above (2, 4, 8, 12,
18, 22, 28≈, 52, 5) — not because one copies the other (confirmed independent
Claude calls), but because this is the same dominant org (FAITH Foundation) being
scored by a structurally similar low-differentiation prompt pattern against the
same underlying poor-fit reality. n=40 is too small over only 3 days to separate
"genuinely this org's opportunities are uniformly bad fits" from "this prompt also
collapses onto round low numbers" with confidence — flagged for 17.5 to re-run
this comparison once volume grows past ~200 rows.

**UI:** `FundabilityPanel.tsx` (rendered in `OpportunityDetail.tsx:1135`) fetches
the full row but **does not render `overall_score` by name** — it shows
`probability_without_fixes` / `probability_with_fixes` tiles instead. Traced in
source (:974-977): `probabilityWithoutFixes = base.overall_score` — same number,
different field name. So the customer does see this score, just not the column
this audit's own `OUTPUT_LOCATIONS` registry pointed at.

---

### `success_probability` — src/lib/agents/success-probability.ts

**Contract:** `success_probability_scores.{probability_score, factors}`, a weighted
sum of `trackRecord (20) + eligibilityScore (25) + narrativeQuality (15) +
deadlineProximity (10) + competitionDensity (10) + givingHistoryMatch (20)`, each
factor carrying its own `{score, reason, maxScore, estimated}`.

**n = 9** (application-scoped, low volume). Date range: 2026-08-27 → 2026-09-19.

**Full distribution (7 distinct values, n=9):**

| probability_score | count |
|---:|---:|
| 60 | 3 |
| 69 | 1 |
| 63 | 1 |
| 55 | 1 |
| 53 | 1 |
| 42 | 1 |
| null | 1 |

Nullity: 11.1% (1/9). Grounding: `factors` non-empty on 8/9 (88.9%).

**Verdict: USEFUL, small-sample caveat.** This is the best-designed score in the
family: every factor is individually attributed with an honest, human-readable
reason (`"Only 1 outcome for this funder category (need 3); using midpoint."`,
`"Eligibility score 82/100."`, `"No competition data available; using midpoint."`)
and an explicit `estimated: true/false` flag distinguishing a real input from a
fallback midpoint. This is the pattern the rest of the family should copy. n=9 is
too small to rule out later regression; re-check at 17.5 once volume grows.
Note: this table is a *different* number from the similarly-named
`SuccessProbabilityCard` shown on `OpportunityDetail.tsx:1116`, which is a live,
opportunity-scoped computation via `/api/opportunities/[id]/probability`
(`src/lib/intelligence/success-probability.ts`) and does not read this table —
the two are easy to conflate by name; they are not the same feature.

**UI:** `ApplicationDetail.tsx:145-194` (fetched by `application_id`) and
`pipeline.ts:421-476` for pipeline views.

---

### `ag22_propensity_scoring` — src/lib/agents/ag-22-propensity-scoring.ts

**Contract:** `corporate_prospects.scores` = `Record<"PS-01".."PS-10",
PropensityScoreValue>`, each `{score, rationale, top_factors}` from its own Claude
call. `PS-01` ("Overall Donation Likelihood") is the headline field — a
*deterministic* weighted aggregate of the other rubrics
(`Cash×0.3 + In-Kind×0.2 + Volunteer×0.1 + Equipment×0.1 +
max(Housing/Education/Food/Veteran/Disaster)×0.3`), not itself a fresh Claude call.
`clampScore()` (:190-195) defaults unparseable Claude output to `0`, documented
explicitly as "no evidence of propensity, never a fabricated midpoint" — an honest
error-path default, not a silent one.

**n = 50** (corporate_prospects table; 50/50 prospects currently have a computed
score — a stale in-repo comment elsewhere claims 1/49, contradicted by this live
check). Date range: 2026-09-17 → 2026-09-18.

**Full distribution (PS-01.score, top 12 of 20 distinct values, n=50):**

| PS-01 score | count |
|---:|---:|
| 38 | 6 |
| 42 | 6 |
| 37 | 5 |
| 41 | 4 |
| 49 | 3 |
| 51 | 3 |
| 43 | 3 |
| 40 | 3 |
| 36 | 2 |
| 39 | 2 |
| 45 | 2 |
| 46 | 2 |
| (8 more values, 1 each) | 8 |

Nullity: 0.0%. Grounding: `PS-01.rationale`/`top_factors` non-empty on 50/50
(100%), and — unlike every other agent above — verified genuinely per-company
content: two spot-checked rows show different company names, different dominant
compatibility categories ("Housing Compatibility (62)" vs. "Disaster Relief
Compatibility (35)"), and different sub-factor scores driving the aggregate.

**Verdict: USEFUL.** The best-differentiated score in the family (20 distinct
values over 50 rows, no value above 12% share) with genuine per-prospect factor
attribution. One sampled prospect is itself a synthetic
`EXERCISE-HARNESS-Fixture Prospect Inc` row — immaterial to the verdict, noted for
completeness. Worth monitoring: the `clampScore(x, 0)` fallback means a spike of
production `PS-01=0` scores with the canned rationale `"Unable to compute a
rationale from available enrichment data."` would silently indicate a rising
Claude-parse-failure rate; not observed in this sample, but nothing currently
alerts on it.

**UI:** `donor-discovery/marketplace/page.tsx:276,306-309`, colored pill
(green≥60/yellow≥30/red<30), tooltip "Overall propensity score (PS-01)". Caveat
found by the UI sweep: sort-by-score on that page is a **text, not numeric**,
comparison — a real display bug, out of scope for this scoring-accuracy report
but worth flagging for 17.5.

---

### `funder_relationship` — src/lib/agents/funder-relationship.ts

**Contract:** `funder_relationship_scores.relationship_score`, plus
`total_interactions`, `successful_applications`, `trend`, `recent_events[]`.

**n = 8.** Date range: 2026-08-16 → 2026-09-19.

**Full distribution (4 distinct values, n=8):**

| relationship_score | count |
|---:|---:|
| 0  | 5 |
| 5  | 1 |
| 60 | 1 |
| 2  | 1 |

Nullity: 0.0%. Grounding: `recent_events` non-empty on 3/8 (37.5%).

**Verdict: INSUFFICIENT SAMPLE.** n=8 is below any threshold this audit trusts for
a variance verdict. The two rows inspected in full (`score=5`, 1 interaction,
`cold_outreach_sent` event; `score=60`, 3 interactions, `0` successful
applications) show plausible internal consistency between `total_interactions`
and `relationship_score`, not obviously wrong, but not enough rows to confirm the
formula behaves sanely across a real relationship's lifecycle. Re-run at 17.5 once
volume passes ~30.

**UI:** `FunderDetail.tsx:161-200,1588-1613`, `RelationshipScoreBadge`
("{score}/100" with a trend arrow and a "stale" warning badge).

---

### `corporate_intent_signals` (`ag-30-donor-intent`) — src/lib/agents/donor-intent-monitor-agent.ts

**Contract:** `corporate_intent_signals.intent_score` + `signal_summary` +
`signal_url` per detected intent signal.

**n = 0.** Table has never received a single row.

**Verdict: INSUFFICIENT SAMPLE — zero rows, ever.** This is not "low volume," it is
complete absence. The scoring mechanism cannot be assessed because it has never
executed successfully (or has never found a signal worth writing — the code was
not re-audited in this pass to distinguish "never runs" from "runs and finds
nothing"; either way, the customer-visible number does not exist).

**UI:** `donor-discovery/intent-signals/page.tsx:219,269-271,518` renders a large
colored number by `HIGH_INTENT_THRESHOLD` — a fully built page with nothing to
show.

---

### `autoapply_risk_engine` — src/lib/autoapply/risk-engine.ts

**Contract:** deterministic (non-Claude) rule-based points sum —
`RiskAssessment{score, classification, factors, recommendation, shouldNotify}`,
persisted as `submission_queue.risk_score` (flat numeric) +
`submission_queue.risk_factors` (the factor array).

**n = 8** lifetime rows. Date range: 2026-08-22 → 2026-09-18.

**Full distribution (1 distinct value, n=8):**

| risk_score | count |
|---:|---:|
| 95 | 8 |

Nullity: 0.0%. Grounding: `risk_factors` non-empty on 8/8 (100%).

**Verdict: INSUFFICIENT SAMPLE, not DEGENERATE — every row is a test fixture.**
All 8 rows carry `status: "skipped"` and reference funders literally named
`AUTOAPPLY_RISK_TEST_FUNDER_<random>` — synthetic integration-test data, not real
funder portals. The identical `risk_score=95` for all 8 is explained by all 8
sharing the same fixed test scenario (`manual_only_portal +40`,
`first_submission +10`, `no_form_template +20`, `org_not_ready +25` = 95), not by
a broken formula — the arithmetic is correct for that input. The real finding is
that this deterministic engine, which gates whether an AutoApply submission is
allowed to run unattended, has **never once scored a real submission** in
production.

**UI:** `ManualQueue.tsx:103-109,607-611,1238-1242`, badges ≤25 green "Low" / ≤50
yellow "Medium" / else red "High".

---

## B. PIL "qualification squad" and related PIL scoring agents

Every agent in this section returned **INSUFFICIENT SAMPLE**. `pil_agent_runs` has
122 lifetime rows platform-wide, but only 52 of those carry a goal string
containing `EXERCISE-HARNESS` — meaning the scoring squads below are not simply
"low volume across a healthy PIL fleet," they specifically are the layer of PIL
that has barely run at all, real or synthetic, while other PIL agents (discovery/
`dis`, individual-intelligence/`int`) apparently account for the other ~70 runs.
None of the runs below reflect a real prospect being qualified for a real customer.

| Agent | Contract (own type, quoted) | n | Status |
|---|---|---:|---|
| `BEN-QLF-01` | `MissionAffinityReport{causeAlignmentScore, populationAlignmentScore, programAlignmentScore, geographicAlignmentScore, recencyScore, overallScore, confidence, evidenceRefs}` | 1 | `{"skipped": true, "reason": "BEN-QLF-01 requires an existing prospectId"}` |
| `BEN-QLF-02` | `FundingEligibilityReport{eligible, ..., fundingEligibilityScore, confidence, disqualifyingReasons}` | 1 | same skip shape |
| `BEN-QLF-03` | `CapacityPropensityReport{capacityEstimateLow/High, capacityConfidence, propensityScore, propensityConfidence, ...}` | 2 | same skip shape |
| `BEN-QLF-04` | `QualificationReport{dimensionScores, overallScore, classification, decision, confidence}` — classification/decision are the primary customer answer | 4 | same skip shape |
| `BEN-QLF-05` | `TimingReadinessReport{relationshipMaturityScore, tenantReadinessScore, documentReadinessScore, ...}` | 1 | same skip shape |
| `BEN-KNW-01` | `DigitalTwinReport{completenessScore, conflictedFields, researchGaps}` (internal data-quality metric, not customer-facing) | 3 | same skip shape |
| `BEN-KNW-02` | `EntityResolutionPairResult[]{matchScore, status, signals, merged}` — drives automatic prospect-dedup merges | 2 | 2 real-ish rows, too few to assess |
| `BEN-KNW-03` | `EvidenceProvenanceReport{evidenceQualityScore, claimSupportScore, sourceDirectnessScore, sourceIndependenceScore}` (internal evidence-integrity metric) | 3 | same skip shape |
| `BEN-REL-04` | relationship-graph `decision{..., overlapConfidence}` (internal graph-edge confidence) | 2 | 1 real decision object, 1 skip |
| `BEN-STR-02` | `BestFirstAskReport{capacityScore, propensityScore, missionAffinityScore, recommendedAskLow/High}` — feeds the recommended donor ask amount | 1 | same skip shape |
| `BEN-APP-01` | `ApplicationRecommendation{successProbability, confidence, strategicReasoning, riskFactors}` — rendered live on the AutoApply queue page | 1 | 1 row, cannot assess variance |
| `BEN-APP-02` | `PriorityRankingReport.ranked[]{priorityScore, priorityPercentile}` — rendered live on the AutoApply queue page | 1 | 1 row, cannot assess variance |
| `BEN-SUP-04` | allocation `scored[]{prospectId, value, depthAchieved, proximityToGoal, prospectScore}` (internal research-budget weighting) | 7 runs / 30 flattened items | see note below |

**`BEN-SUP-04` note (the one agent here with enough flattened items to compute a
distribution):** 30 scored items across 7 runs, distinct=4,
`value=0.3964285714285714` on 18/30 (60%), `value=0` on 7/30 (23%). Traced
(`BEN-SUP-04.ts:66-79`): `prospectScore` is the mean of an evidence set's
`confidence` field, `proximityToGoal` is `completedSteps/totalSteps`; when a
scored run has `prospectId: null` and `depthAchieved: 0` (verified in the raw
`scored[]` payload — most items in the most recent run have exactly this shape),
both terms are `0` by construction, and `value` is `0` too. The repeating
non-zero value most likely reflects the same one or two still-active research
runs being re-scored, unchanged, across consecutive allocator cycles — a symptom
of a stalled research pipeline (consistent with prior audit notes on PIL
immaturity), not a formula bug. This is internal allocation weighting; it is not
shown to any customer.

**UI for the customer-facing PIL fields specifically:** the PIL dashboard
(`src/app/(dashboard)/intelligence/pil/**`) does **not** render `overallScore`,
`fundingEligibilityScore`, `propensityScore`, `classification`, `successProbability`,
`capacityScore`, or `missionAffinityScore` anywhere — the prospect page
deliberately shows "See dossier" instead of a number (an anti-fabrication comment
exists at the top of that file). The two PIL scoring fields that *are*
customer-visible (`successProbability` from `BEN-APP-01`, `priorityScore` from
`BEN-APP-02`) surface on the **AutoApply queue page**
(`src/app/(dashboard)/autoapply/queue/page.tsx:184-186,363-366,380-393`), not the
PIL dashboard — and, per the table above, each has exactly one lifetime row, so
whatever a customer sees there today is a single harness-generated data point,
not a converged score.

---

## C. Methodology correction: `ag-17-discovery` is not a distinct scorer

The original AR-17.1 registry lists `ag-17-discovery`
(`src/lib/agents/opportunity-discovery-agent.ts`) as writing `opportunities.
eligibility_score`. Reading the module's own header comment (:66-70) shows this is
a misattribution: *"Freshly-discovered opportunities have no `eligibility_score` —
that column is written by a separate agent (AG-02 / `eligibility-scorer.ts`) that
has not run against them yet."* The 500-row sample taken through this "agent"
(filtered to `source=eq.agent`) is 57.8% null (opportunities awaiting their first
real scoring pass) and, for the 42.2% with a value, is simply
`eligibility_scoring`'s own later write on the same column, sliced by a different
filter — not an independent scoring mechanism. No separate verdict is given; see
`eligibility_scoring` above for the real assessment of this column.

---

## D. Supporting/adjacent agent: `consensus_validation`

**Contract:** `validations.{verdict, confidence, details}` from
`consensus-validator.ts`. On any parse failure, `parseVerdict()` (:168-206)
explicitly returns `{verdict: "unverifiable", confidence: 0}` — a documented,
honest low-confidence signal, not a silent default masquerading as a real
midpoint (worth contrasting with `ag-22`'s structurally similar-looking
`clampScore(x, 0)`, which means something different: "could not compute," not
"computed and it's genuinely low").

**n = 4**, all from the `EXERCISE-HARNESS-Test Foundation` org.

**Verdict: INSUFFICIENT SAMPLE.** One inspected row shows real, substantive,
opportunity-specific content (`confidence: 97`, `verdict: "discrepancy"`, detail
text explaining a specific inconsistency in a grant's award-amount fields) — a
promising sign of genuine grounding — but n=4, all synthetic-org-triggered, is far
too small to issue a distribution verdict.

---

## Verdict summary

| Agent | Verdict | n (real / total) |
|---|---|---|
| `ag-15-probability` (`opportunity_probability_scores`) | **DEGENERATE** — 95.6% hardcoded-constant pass-through, cause traced to `grant-probability-engine.ts:18-20,175-199` | 1,015 |
| `eligibility_scoring` | THIN — real per-row reasoning, coarse/clustered numeric resolution | 902 |
| `ag-29-fundability` | THIN — same shape as above, smaller sample | 40 |
| `success_probability` | USEFUL — best factor transparency in the family, small n | 9 |
| `ag22_propensity_scoring` | USEFUL — best differentiation, genuine per-prospect grounding | 50 |
| `autoapply_risk_engine` | INSUFFICIENT SAMPLE — 8/8 rows synthetic test fixtures, never run on real traffic | 0 real / 8 |
| `corporate_intent_signals` (`ag-30-donor-intent`) | INSUFFICIENT SAMPLE — zero rows, ever | 0 |
| `funder_relationship` | INSUFFICIENT SAMPLE | 8 |
| `consensus_validation` | INSUFFICIENT SAMPLE | 4 (all synthetic-org) |
| `BEN-QLF-01` .. `BEN-QLF-05` (qualification squad) | INSUFFICIENT SAMPLE — never scored a real prospect | 1–4 each |
| `BEN-KNW-01`, `BEN-KNW-02`, `BEN-KNW-03` | INSUFFICIENT SAMPLE | 2–3 each |
| `BEN-REL-04` | INSUFFICIENT SAMPLE | 2 |
| `BEN-STR-02` | INSUFFICIENT SAMPLE | 1 |
| `BEN-APP-01`, `BEN-APP-02` | INSUFFICIENT SAMPLE | 1 each |
| `BEN-SUP-04` (internal, not customer-facing) | DEGENERATE-looking but explained by pipeline stall, not a formula bug | 7 runs / 30 items |
| `ag-17-discovery` | not a distinct agent — see `eligibility_scoring` | n/a |

**Of the 25 scoring entries assessed with a real production sample, 2 (`success_
probability`, `ag22_propensity_scoring`) show genuinely varied, well-grounded
scores. 1 (`ag-15-probability`) is confirmed DEGENERATE with a fully-traced
mechanical cause. 2 (`eligibility_scoring`, `ag-29-fundability`) are THIN —
real content, suspiciously coarse numeric resolution, not yet traced to a single
line. The remaining 12+ either have zero or near-zero real-world executions.**
