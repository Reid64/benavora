ALTER TABLE organizations ADD COLUMN IF NOT EXISTS white_label_config jsonb DEFAULT '{}';
