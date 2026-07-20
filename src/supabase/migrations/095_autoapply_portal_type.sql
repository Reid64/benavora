-- Migration 095: Portal type classification for AutoApply funders
--
-- Real-schema note: the task spec that motivated this asked for a per-submission
-- `portal_type` enum ('cybergrants'|'benevity'|'yourcause'|'blackbaud'|'generic'
-- |'unknown'). The portal is a property of the funder's giving page
-- (funders.giving_portal_url), not of any individual submission -- classified
-- once and reused by every future submission to that same funder, consistent
-- with BLUEPRINT_v2.md section 4.2 Core Data Principle #1 ("every entity has
-- one source of truth table. Never duplicate across tables"). Living on
-- funders also means the existing submission_queue/autoapply_submissions rows
-- (migration 045) never need a backfill.

ALTER TABLE funders
  ADD COLUMN IF NOT EXISTS portal_type text;
