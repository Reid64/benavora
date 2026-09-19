-- 202_probability_scores_insufficient_data.sql
--
-- AR-17.5 fix for the AR-17.2 DEGENERATE finding: opportunity_probability_scores
-- (093_digital_twins.sql) had no way to distinguish "a real 0-100 probability was
-- computed" from "the deterministic engine fell back to hardcoded neutral
-- constants because eligibility_score/outcomes/deadline were missing." 478/500
-- sampled production rows were the latter, silently, wearing the former's
-- clothes. grant-probability-engine.ts and probability-scoring-agent.ts now
-- write an explicit status instead, and every write also carries the evidence
-- (which stored inputs backed the number, or its absence) behind it.
--
-- overall_score/confidence/recommendation/key_risks/key_strengths/estimated_roi/
-- time_to_complete are all already nullable (093_digital_twins.sql has no NOT
-- NULL on any of them) -- no existing column needs widening.

ALTER TABLE opportunity_probability_scores
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scored'
    CHECK (status IN ('scored', 'insufficient_data')),
  ADD COLUMN IF NOT EXISTS insufficient_data_reasons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS evidence jsonb;

COMMENT ON COLUMN opportunity_probability_scores.status IS
  'scored: overall_score is a real computed probability. insufficient_data: too few real inputs existed to compute one -- overall_score is null by design, not a default. Set by grant-probability-engine.ts / probability-scoring-agent.ts.';
COMMENT ON COLUMN opportunity_probability_scores.insufficient_data_reasons IS
  'Populated only when status=insufficient_data. Names exactly which real inputs (eligibility_score, outcomes, deadline, Digital Twin) were missing.';
COMMENT ON COLUMN opportunity_probability_scores.evidence IS
  'Which stored inputs (and how many were real vs. fallback) produced this row -- see GrantProbabilityEvidence in grant-probability-engine.ts. Present on every row going forward; null on rows written before this migration.';

-- Existing rows keep status='scored' (the column default) -- this migration
-- does not retroactively reclassify historical rows as insufficient_data.
-- Re-running the scoring agents (batch-score-opportunities.ts / the nightly
-- AG-15 agent run) naturally corrects each row's status the next time it is
-- recomputed, which is the intended remediation path, not a bulk UPDATE here.
