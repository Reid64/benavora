-- 079_donor_discovery_prospects_enrichment_private.sql — tenant-private
-- connector enrichment storage on donor_discovery_prospects
-- (DONOR_DISCOVERY_ARCHITECTURE.md §6: "Connector results write into
-- donor_discovery_prospects.enrichment_private (tenant-scoped), merge-
-- displayed with shared enrichment in the UI").
--
-- Distinct from donor_discovery_directory.enrichment (migration 067), which
-- is the SHARED, no-RLS §2B web enrichment record every tenant sees. Contact
-- data acquired through a tenant's own paid connector key (Apollo/Hunter) is
-- contractually theirs alone per §6 — it belongs on the org-scoped
-- donor_discovery_prospects row, already RLS-protected by the
-- "donor_discovery_prospects_org_isolation" policy (migration 067), never on
-- the shared directory row.
--
-- File only — not applied to production per this task's instructions.

ALTER TABLE public.donor_discovery_prospects
  ADD COLUMN IF NOT EXISTS enrichment_private jsonb NOT NULL DEFAULT '{}'::jsonb;
