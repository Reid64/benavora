-- 131_profiles_command_center_layout.sql
--
-- Backing column for FEATURE_REGISTRY_v2.md #154 "Configurable Panel Layout"
-- (Command Center, Phase 3) — per-owner drag-and-drop panel ordering,
-- persisted so a reorder survives a page reload.
--
-- Chose profiles.command_center_layout (jsonb) over a new dashboard_layout_
-- preferences table: the Command Center is gated to profiles.role = 'owner'
-- (src/app/(dashboard)/command-center/page.tsx), so "per-owner" here is
-- genuinely "per profiles row" — one viewer, one layout. A whole new table
-- keyed on profile_id with a single jsonb column would be a 1:1 relation
-- with no independent lifecycle of its own (no need to list/delete/share
-- layouts across viewers), so it would only add a join for no real benefit.
-- profiles already has no reordering/layout concept to collide with.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS command_center_layout jsonb;
