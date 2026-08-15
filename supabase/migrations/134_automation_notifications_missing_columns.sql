-- ============================================================================
-- Migration 134 — automation_notifications missing columns
--
-- Found live 2026-08-15 during a real end-to-end smoke test: GET
-- /api/notifications 500s on every call, for every org, because the live
-- table lacks title/related_entity_type/related_entity_id — three columns
-- migration 036_automation_notifications.sql already declares, but the live
-- table was evidently created independently of that file (see project memory
-- "Two parallel migrations directories" / migration-audit findings for the
-- same drift pattern elsewhere). 14 call sites across the codebase already
-- read/write these columns as if they existed. Table had 0 live rows at the
-- time of this fix, so no backfill is needed; columns are added nullable
-- (not NOT NULL, unlike migration 036's original intent) since this ALTER
-- must not assume anything about rows written between audit and apply.
-- ============================================================================

ALTER TABLE automation_notifications
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS related_entity_type text,
  ADD COLUMN IF NOT EXISTS related_entity_id uuid;
