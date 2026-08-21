-- 142_donor_discovery_ntee_taxonomy.sql -- adds NTEE major-group taxonomy
-- nodes to donor_discovery_taxonomy (WGR-158/WGR-159 BMF directory adapter).
--
-- Problem: donor_discovery_taxonomy only ever had
-- kind IN ('naics','civic','association') -- zero NTEE codes existed
-- anywhere, so there was no way to request a states/national Donor
-- Discovery search filtered by NTEE major group, the BMF
-- (foundation_directory) adapter's own filter concept, parallel to how the
-- Places (Google) adapter filters by NAICS code.
--
-- This migration does two things:
--   1. Adds 'ntee' as a new donor_discovery_taxonomy_kind enum value. Run
--      as its own top-level statement (not inside an explicit transaction
--      block with the INSERT below) -- Postgres does not allow a newly
--      added enum value to be used in the same transaction it was added
--      in; applying this file via a plain `psql -f` (autocommit, no
--      --single-transaction) commits this statement before the INSERT
--      runs.
--   2. Seeds one taxonomy row per real NTEE major group letter (the
--      standard 26-group IRS classification, A-Z) -- code is the bare
--      letter, label is the group's standard name. Seeded for all 26
--      groups, not just the ones one specific task happened to name,
--      matching how every NAICS sector is already seeded rather than only
--      a hand-picked subset. Idempotent: only inserts if zero 'ntee' rows
--      already exist (donor_discovery_taxonomy has no unique constraint on
--      (kind, code) to key an ON CONFLICT off of).

ALTER TYPE donor_discovery_taxonomy_kind ADD VALUE IF NOT EXISTS 'ntee';

INSERT INTO donor_discovery_taxonomy (kind, code, label)
SELECT * FROM (
  VALUES
    ('ntee'::donor_discovery_taxonomy_kind, 'A', 'Arts, Culture, and Humanities'),
    ('ntee'::donor_discovery_taxonomy_kind, 'B', 'Educational Institutions and Related Activities'),
    ('ntee'::donor_discovery_taxonomy_kind, 'C', 'Environmental Quality, Protection, and Beautification'),
    ('ntee'::donor_discovery_taxonomy_kind, 'D', 'Animal-Related'),
    ('ntee'::donor_discovery_taxonomy_kind, 'E', 'Health - General and Rehabilitative'),
    ('ntee'::donor_discovery_taxonomy_kind, 'F', 'Mental Health, Crisis Intervention'),
    ('ntee'::donor_discovery_taxonomy_kind, 'G', 'Voluntary Health Associations and Medical Disciplines'),
    ('ntee'::donor_discovery_taxonomy_kind, 'H', 'Medical Research'),
    ('ntee'::donor_discovery_taxonomy_kind, 'I', 'Crime, Legal-Related'),
    ('ntee'::donor_discovery_taxonomy_kind, 'J', 'Employment, Job-Related'),
    ('ntee'::donor_discovery_taxonomy_kind, 'K', 'Food, Agriculture, and Nutrition'),
    ('ntee'::donor_discovery_taxonomy_kind, 'L', 'Housing, Shelter'),
    ('ntee'::donor_discovery_taxonomy_kind, 'M', 'Public Safety, Disaster Preparedness, and Relief'),
    ('ntee'::donor_discovery_taxonomy_kind, 'N', 'Recreation, Sports, Leisure, Athletics'),
    ('ntee'::donor_discovery_taxonomy_kind, 'O', 'Youth Development'),
    ('ntee'::donor_discovery_taxonomy_kind, 'P', 'Human Services - Multipurpose and Other'),
    ('ntee'::donor_discovery_taxonomy_kind, 'Q', 'International, Foreign Affairs, and National Security'),
    ('ntee'::donor_discovery_taxonomy_kind, 'R', 'Civil Rights, Social Action, Advocacy'),
    ('ntee'::donor_discovery_taxonomy_kind, 'S', 'Community Improvement, Capacity Building'),
    ('ntee'::donor_discovery_taxonomy_kind, 'T', 'Philanthropy, Voluntarism, and Grantmaking Foundations'),
    ('ntee'::donor_discovery_taxonomy_kind, 'U', 'Science and Technology Research Institutes, Services'),
    ('ntee'::donor_discovery_taxonomy_kind, 'V', 'Social Science Research Institutes, Services'),
    ('ntee'::donor_discovery_taxonomy_kind, 'W', 'Public, Society Benefit - Multipurpose and Other'),
    ('ntee'::donor_discovery_taxonomy_kind, 'X', 'Religion-Related, Spiritual Development'),
    ('ntee'::donor_discovery_taxonomy_kind, 'Y', 'Mutual/Membership Benefit Organizations, Other'),
    ('ntee'::donor_discovery_taxonomy_kind, 'Z', 'Unknown')
) AS v(kind, code, label)
WHERE NOT EXISTS (SELECT 1 FROM donor_discovery_taxonomy WHERE kind = 'ntee');
