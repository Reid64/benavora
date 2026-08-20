-- Minimal schema for PT-08 agent_queue lifecycle testing.
-- agent_queue DDL copied verbatim from
-- src/supabase/migrations/080_autonomous_agent_infrastructure.sql (lines 23-44),
-- minus the RLS policy (auth.uid()/profiles don't exist in this disposable DB
-- and RLS is irrelevant to queue *semantics*, which this test targets).
-- organizations is a minimal stand-in for the real table's PK/name columns
-- only, sufficient to satisfy agent_queue.org_id's FK.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE agent_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  priority integer DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status text DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  trigger_source text NOT NULL CHECK (trigger_source IN ('autonomous','manual','chain','schedule')),
  input_payload jsonb DEFAULT '{}',
  output_payload jsonb DEFAULT '{}',
  decision_log jsonb DEFAULT '[]',
  error_message text,
  queued_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3
);
CREATE INDEX idx_agent_queue_status ON agent_queue(status, priority DESC, queued_at ASC);
CREATE INDEX idx_agent_queue_org ON agent_queue(org_id, agent_id, status);
