-- ============================================================================
-- BENAVORA - Migration 043: opportunities.opportunity_documents
--
-- Linked documents (PDFs) discovered for an opportunity, as a jsonb array of
-- { title, url }. Populated by the Grants.gov two-pass fetch (the detail API
-- returns the opportunity's attached documents). Additive and idempotent.
-- ============================================================================

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS opportunity_documents jsonb;

-- ============================================================================
-- END Migration 043
-- ============================================================================
