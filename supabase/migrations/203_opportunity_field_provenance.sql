-- AR-17.6: structural provenance enforcement for `opportunities`.
--
-- AR-17.3 found 0.0% of 6,309 enriched funder fields (description, deadline,
-- eligibility_requirements, amount_min/max/available, geographic_restrictions,
-- application_method, required_documents) carry a *stored* source -- 98.4%
-- carry only a bare `url` pointer to a live page that may since have
-- changed, and 39 rows carried no source pointer of any kind (24 with a
-- deadline, 4 with eligibility text -- actionable claims with nothing to
-- verify them against, ever).
--
-- This migration does not retrofit richer provenance (a `url` pointer or an
-- `opportunity_documents` reference is still the best this schema offers
-- per-field) -- it enforces the minimum bar structurally: an enriched field
-- cannot be written or changed unless the row carries *some* stored source
-- in the same write. Convention-only enforcement (an agent remembering to
-- also set `url`) is exactly the pattern that produced the AR-17.3 findings
-- -- several agent files set every enriched field unconditionally and `url`
-- only if truthy, so a source-less scrape silently produced a source-less
-- row. Those call sites were fixed in this same change (src/lib/agents/
-- state-portal.ts, sam-gov.ts, grants-gov.ts, simpler-grants.ts,
-- hud-monitor.ts, foundation-finder.ts, corporate-scraper.ts,
-- housing-specific-scrapers.ts, state-scrapers.ts, tdhca-scraper.ts,
-- nofa-parser.ts) -- this trigger is the backstop for every future call
-- site, not a substitute for fixing the ones found this round.
--
-- eligibility_score / recommendation / recommendation_reasoning /
-- match_percentage / is_high_priority / match_mismatch_reasons /
-- mission_relevance_score are deliberately excluded: those are agent-owned
-- scores computed from already-stored opportunity fields, not facts scraped
-- from an external source (BEHAVIORAL_CONTRACTS §5), so they carry no
-- external source to require.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz,
  ADD COLUMN IF NOT EXISTS quarantine_reason text;

CREATE OR REPLACE FUNCTION enforce_opportunity_field_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  enriched_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    enriched_changed := (
      NEW.description IS NOT NULL
      OR NEW.deadline IS NOT NULL
      OR NEW.eligibility_requirements IS NOT NULL
      OR NEW.amount_min IS NOT NULL
      OR NEW.amount_max IS NOT NULL
      OR NEW.amount_available IS NOT NULL
      OR NEW.geographic_restrictions IS NOT NULL
      OR NEW.application_method IS NOT NULL
      OR NEW.required_documents IS NOT NULL
      OR NEW.recurrence IS NOT NULL
    );
  ELSE
    enriched_changed := (
      NEW.description IS DISTINCT FROM OLD.description
      OR NEW.deadline IS DISTINCT FROM OLD.deadline
      OR NEW.eligibility_requirements IS DISTINCT FROM OLD.eligibility_requirements
      OR NEW.amount_min IS DISTINCT FROM OLD.amount_min
      OR NEW.amount_max IS DISTINCT FROM OLD.amount_max
      OR NEW.amount_available IS DISTINCT FROM OLD.amount_available
      OR NEW.geographic_restrictions IS DISTINCT FROM OLD.geographic_restrictions
      OR NEW.application_method IS DISTINCT FROM OLD.application_method
      OR NEW.required_documents IS DISTINCT FROM OLD.required_documents
      OR NEW.recurrence IS DISTINCT FROM OLD.recurrence
    );
  END IF;

  -- Only a *change* to an enriched field is gated -- a row that already
  -- exists without provenance (pre-dating this migration) can still be
  -- touched for unrelated columns (e.g. eligibility_score, status) without
  -- being blocked by a defect it didn't introduce. It cannot, however,
  -- acquire a NEW or CHANGED enriched value without also carrying a source
  -- in that same write.
  IF enriched_changed
     AND NEW.url IS NULL
     AND NEW.opportunity_documents IS NULL
  THEN
    RAISE EXCEPTION
      'opportunities: enriched field written with no stored source (url or opportunity_documents). organization_id=%, name=%',
      NEW.organization_id, NEW.name
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_opportunity_field_provenance ON opportunities;
CREATE TRIGGER trg_enforce_opportunity_field_provenance
  BEFORE INSERT OR UPDATE ON opportunities
  FOR EACH ROW
  EXECUTE FUNCTION enforce_opportunity_field_provenance();

-- Quarantine: the 39 rows AR-17.3 found with NO source pointer at all (the
-- highest-risk rows on the platform per that audit -- 24 carry a deadline, 4
-- carry eligibility text). This is a DISTINCT action from contradiction
-- quarantine: AR-17.3's fabrication spot-check found 0 contradicted claims,
-- because 0 of the 10 sampled claims were checkable at all -- there is
-- nothing to quarantine on the contradiction count, and this migration does
-- not fabricate a nonzero number there to look more decisive. Rows are
-- flagged, not deleted or corrected, so a human can re-verify them; every
-- future write to one of these rows still passes through the trigger above.
UPDATE opportunities
SET quarantined_at = now(),
    quarantine_reason = 'AR-17.6: no stored source (url or opportunity_documents) at time of assessment; re-verify before treating as actionable'
WHERE url IS NULL
  AND opportunity_documents IS NULL
  AND quarantined_at IS NULL
  AND (
    description IS NOT NULL
    OR deadline IS NOT NULL
    OR eligibility_requirements IS NOT NULL
    OR amount_min IS NOT NULL
    OR amount_max IS NOT NULL
    OR amount_available IS NOT NULL
    OR geographic_restrictions IS NOT NULL
    OR application_method IS NOT NULL
    OR required_documents IS NOT NULL
  );
