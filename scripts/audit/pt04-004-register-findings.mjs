import { appendFindingRow } from "./evidence-lib.mjs";

appendFindingRow({
  id: "WGR-135",
  layer: "Business Logic",
  severity: "P1",
  description:
    "PT-04-001/PT-04-004: computeGrantProbability()'s persisted opportunity_probability_scores rows " +
    "are never recomputed when their underlying input data changes -- a real, live, currently- " +
    "reproducing staleness bug, not confined to one hand-picked example. Hand-verified via independent " +
    "reimplementation of the documented formula (src/lib/intelligence/grant-probability-engine.ts) " +
    "against opportunity 8851652c-... (Texas CDBG Housing, org b1ab7402-...): the row's " +
    "eligibility_score factor is pinned at the neutral fallback value 0.5 (contribution 15) even though " +
    "opportunities.eligibility_score is now 72 (non-null, populated 2026-08-19, 17 days after " +
    "opportunity_probability_scores.computed_at 2026-08-02) -- applying the real, current " +
    "eligibility_score to the SAME documented formula produces overall_score=47 (contribution 21.6) vs " +
    "the system's actual persisted/returned overall_score=42, a 5-point discrepancy on the one number " +
    "src/app/(dashboard)/opportunities/page.tsx's own header comment says the UI reads verbatim and " +
    "NEVER recomputes. Corroborated independently against the row's own stored key_risks array, which " +
    "still contains the string 'No eligibility score computed for this opportunity yet.' -- text " +
    "buildKeyRisks() only emits when eligibility_score IS NULL, directly contradicting the column's " +
    "current non-null value. Not an isolated instance: a live query of 9 real " +
    "opportunity_probability_scores rows currently satisfying the engine's own real-data precondition " +
    "(opportunities.eligibility_score IS NOT NULL) found the SAME pinned-at-0.5-fallback pattern on 3 " +
    "of 9 (33%) -- all 3 belonging to org b1ab7402 (af4620eb-.../value should be 0.18 not 0.5, " +
    "8851652c-.../0.72 not 0.5, a3e45cc5-.../0.05 not 0.5), all computed 2026-07-30 through 2026-08-02, " +
    "before this org's later eligibility scoring pass populated real values; the other org's 6 sampled " +
    "rows (bed3e621-...) show no drift, since their stored eligibility_score factor already matches the " +
    "current column value exactly on all 6. Root cause: computeGrantProbability() has no " +
    "change-triggered recompute anywhere in the codebase (no DB trigger, no on-write hook from the " +
    "eligibility-scoring agent, no cron sweep) -- once a row is written it stays permanently stale " +
    "relative to the real opportunities/organizational_digital_twins/outcomes data unless something " +
    "re-invokes the function by hand. In the confirmed deep-dive instance the recommendation category " +
    "itself did not flip (both 'consider'), so this specific case is a wrong displayed number, not yet " +
    "a wrong recommendation -- but nothing in the formula prevents a larger real-world drift from " +
    "crossing the apply/consider/skip thresholds (70/40) for other opportunities, which is exactly what " +
    "this staleness mechanism would silently produce, with no error or staleness indicator surfaced " +
    "anywhere in the UI.",
  evidencePath: "test-evidence/pt-04/grant-probability.json, test-evidence/pt-04/candidates-raw.json",
  reproduction:
    "node scripts/audit/pt04-001-fetch-data.mjs (re-pull the 9 real candidate rows against production, " +
    "writes candidates-raw.json); node scripts/audit/pt04-001-grant-probability.mjs (independent " +
    "hand-reimplementation of the formula + diff against the persisted row, writes " +
    "grant-probability.json); node scripts/audit/verify-pt04-001.mjs (evidence-shape gate).",
  scopeTag: "CONFIRMED-BROKEN",
});

appendFindingRow({
  id: "WGR-136",
  layer: "Business Logic",
  severity: "P3",
  description:
    "PT-04-003 pure-function scoring verification: computeConfidence() (src/lib/drafts/generator.ts, " +
    "draft-narrative confidence score), SubmissionValidator.checkOrgReadiness() " +
    "(src/lib/autoapply/submission-validator.ts, AutoApply eligibility gate), and " +
    "computeGrantProbability() (src/lib/intelligence/grant-probability-engine.ts, match/fit " +
    "probability -- the SAME function WGR-135 finds is never re-triggered against live data; tested " +
    "here in isolation as a pure function, not against persisted staleness) were each called directly " +
    "(real, unmodified exported functions, not reimplementations) against 11 total chosen scenarios " +
    "spanning documented branch boundaries, penalty stacking, neutral-fallback values, and exact " +
    "recommendation-threshold edges (score===70 apply/consider boundary; single-vs-dual blocker " +
    "suppression; zero-KB vs base-92 confidence branch; 0-100 clamp under 40 stacked [NEEDS INPUT] " +
    "markers). All 11/11 scenarios' hand-computed expected output (independently derived from each " +
    "function's own documented formula, kept structurally separate from the calls to the real code) " +
    "matched the actual function output exactly -- no wrong threshold, inverted boolean, mis-weighted " +
    "factor, or off-by-one boundary comparator (specifically checked: the apply threshold uses >=70, " +
    "not >70, confirmed via an exact-70 boundary case) found in any of the three functions' own " +
    "internal arithmetic.",
  evidencePath: "test-evidence/pt-04/scoring.json",
  reproduction: "node scripts/audit/pt04-003-scoring.mjs; node scripts/audit/verify-pt04-003.mjs",
  scopeTag: "CONFIRMED-OK",
});

appendFindingRow({
  id: "WGR-137",
  layer: "Business Logic",
  severity: "P3",
  description:
    "PT-04-002 live API verification: GET /api/applications/[id]/reconcile's budget-reconciliation " +
    "report (total_budget/total_spent/variance/compliance_status) and GET /api/deadlines/check's " +
    "deadline-reminder-offset logic (30/14/7/3/1-day thresholds, one-way idempotent reminder flags per " +
    "Contracts §11) were both exercised via real writes and real reads against the live, authenticated " +
    "Next.js API on the production database, using the dedicated E2E test org -- all seeded rows " +
    "deleted/reverted afterward, residue check confirmed 0 remaining across grant_budgets, " +
    "grant_expenses, grant_reconciliation_reports, and the synthetic deadlines. Budget: 4 real budget " +
    "line items ($26,500) + 3 real expenses ($7,000.75) hand-summed independently (plain arithmetic, " +
    "no shared code with the route) produced total_budget=26500/total_spent=7000.75/" +
    "variance=19499.25/compliance_status=under_budget -- the live route's own computed report matched " +
    "exactly, 0 delta on every field. Deadlines: 6 real scenarios (none-crossed at 45 days out; " +
    "exact-30-day boundary; two-thresholds-simultaneous at 10 days; due-today-all-5-fire; " +
    "overdue-partial-with-already-sent-flags-correctly-never-re-firing; one pre-existing real " +
    "production deadline) covering every documented threshold boundary and the " +
    "reminder-flags-are-one-way idempotency rule all matched the hand-computed expected reminder set " +
    "(using date-fns's differenceInCalendarDays directly, not the route's own code) exactly, 6/6.",
  evidencePath: "test-evidence/pt-04/budget-deadline.json",
  reproduction: "node scripts/audit/pt04-002-budget-deadline.mjs; node scripts/audit/verify-pt04-002.mjs",
  scopeTag: "CONFIRMED-OK",
});

console.log("Appended WGR-135, WGR-136, WGR-137.");
