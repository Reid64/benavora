-- Migration 107 — embedding columns for AG-29 Knowledge Engine Indexer's full
-- stated scope (AGENTS_v2.md, 2026-08-03 enterprise spec).
--
-- AG-29's original purpose names 3 sources needing embeddings:
-- intelligence_funded_proposals, outcomes, foundation_directory. Only the
-- first already had one -- and on the wrong table (intelligence_proposal_
-- sections.embedding, migration 048; intelligence_funded_proposals itself
-- has none, confirmed live, correcting the original spec's claimed column
-- location). outcomes and foundation_directory have never had an embedding
-- column at all. Added here, matching the exact real type already proven
-- live on intelligence_proposal_sections (extensions.vector(1536), migration
-- 048) -- not a new/different vector dimension.

ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);
ALTER TABLE foundation_directory ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);
