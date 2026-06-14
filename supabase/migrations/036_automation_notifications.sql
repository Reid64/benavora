-- ============================================================================
-- Migration 036 — automation_notifications
--
-- SCHEMA_REGISTRY v2.0 Table 58: alert records for automation events,
-- agent completions, and system notices.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE notification_channel AS ENUM ('in_app', 'email');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS automation_notifications (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES organizations(id),
  event_type           text        NOT NULL,
  title                text        NOT NULL,
  message              text,
  is_read              boolean     DEFAULT false,
  sent_via             notification_channel DEFAULT 'in_app',
  related_entity_type  text,
  related_entity_id    uuid,
  created_at           timestamptz DEFAULT now()
);

ALTER TABLE automation_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auto_notif_org" ON automation_notifications
  USING (
    organization_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_auto_notif_org
  ON automation_notifications(organization_id);

CREATE INDEX IF NOT EXISTS idx_auto_notif_read
  ON automation_notifications(is_read, created_at DESC);
