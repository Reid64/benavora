-- Migration 087: notification_preferences - per-user, per-org toggles for
-- whether a given notification event type raises an in-app alert and/or an
-- email (used by src/lib/notifications/notify.ts and Settings > Notifications).

CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, organization_id, event_type)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- A user manages only their own preferences, still scoped to their org.
CREATE POLICY "notification_preferences_self" ON notification_preferences
  USING (
    user_id = auth.uid()
    AND organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_notification_prefs_org ON notification_preferences(organization_id);
CREATE INDEX IF NOT EXISTS idx_notification_prefs_user ON notification_preferences(user_id);
