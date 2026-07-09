-- 074_donor_discovery_foundation_linkage_and_scoring.sql — Donor Discovery
-- corporate-foundation linkage (§2C) + deterministic scoring (§2D).
-- Backs src/lib/donor-discovery/foundation-linkage.ts and
-- src/lib/donor-discovery/scoring.ts.
--
-- Three independent pieces:
--
-- 1. `donor_discovery_directory.linked_foundation_id` / `linkage_confidence`
--    (migration 067 didn't have these — the directory record's link to a
--    matching row in `foundation_directory`, migration 046's IRS BMF data,
--    when the operating company likely gives through a dedicated corporate
--    foundation entity, e.g. "Acme Corp" -> "Acme Corp Foundation").
--
-- 2. `donor_discovery_match_foundations` RPC — the expensive half of the
--    name-heuristic match (trigram similarity against `foundation_directory
--    .name`, which holds the full IRS Business Master File and isn't
--    reasonable to pull client-side). Candidate name construction
--    ("<company> Foundation" / "Charitable Trust" / "Fund" / ...) is pure
--    TypeScript in foundation-linkage.ts — this function just scores a
--    caller-supplied candidate list against the real directory.
--
-- 3. `organizations.donor_discovery_scoring_weights` — per-org override of
--    the §2D scoring weights (defaults live in scoring.ts;
--    `parseScoringWeights` merges this column's overrides onto them). Same
--    `jsonb default '{}'` pattern as `white_label_config` (migration 063).
--
-- File only — not applied to production per this task's instructions.

-- ── donor_discovery_directory: foundation linkage columns ──────────────────
ALTER TABLE public.donor_discovery_directory
  ADD COLUMN IF NOT EXISTS linked_foundation_id uuid REFERENCES public.foundation_directory(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linkage_confidence numeric(4,3)
    CONSTRAINT donor_discovery_directory_linkage_confidence_range
    CHECK (linkage_confidence IS NULL OR (linkage_confidence >= 0 AND linkage_confidence <= 1));

CREATE INDEX IF NOT EXISTS donor_discovery_directory_linked_foundation_id_idx
  ON public.donor_discovery_directory(linked_foundation_id);

-- ── foundation_directory: trigram index to back similarity() matching ──────
-- migration 046's idx_foundation_directory_name_fts is a tsvector FTS index,
-- which doesn't accelerate similarity()/`%`. pg_trgm was already enabled by
-- migration 071 for the directory-dedup fuzzy match; CREATE EXTENSION IF NOT
-- EXISTS makes re-declaring it here safe regardless of migration order.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_foundation_directory_name_trgm
  ON public.foundation_directory USING gin (name gin_trgm_ops);

-- ── donor_discovery_match_foundations ───────────────────────────────────────
-- For each row in `foundation_directory`, takes the best trigram similarity
-- across all of `p_candidate_names` against `name`, and returns rows whose
-- best score clears `p_min_similarity`, best match first. Confidence
-- boosting for a matching website domain happens in TypeScript
-- (foundation-linkage.ts), not here — this function only does the fuzzy
-- name search.
CREATE OR REPLACE FUNCTION public.donor_discovery_match_foundations(
  p_candidate_names text[],
  p_min_similarity double precision DEFAULT 0.55,
  p_limit integer DEFAULT 5
) RETURNS TABLE (
  foundation_id uuid,
  foundation_name text,
  website text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT fd.id, fd.name, fd.website, best.sim
  FROM public.foundation_directory fd
  CROSS JOIN LATERAL (
    SELECT max(similarity(lower(fd.name), lower(cand))) AS sim
    FROM unnest(p_candidate_names) AS cand
  ) best
  WHERE best.sim > p_min_similarity
  ORDER BY best.sim DESC
  LIMIT p_limit;
$$;

-- ── organizations: org-overridable scoring weights (§2D) ───────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS donor_discovery_scoring_weights jsonb DEFAULT '{}';
