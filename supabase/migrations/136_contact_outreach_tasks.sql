-- Row #77 Multi-Channel Outreach (ToS-safe build): LinkedIn, phone, and physical-mail
-- channels each generate a real, personalized drafted asset via Claude, then log a real
-- task on the contact's record for a human to send/place/mail manually. No automated
-- LinkedIn API calls, no automated dialing, no automated physical mail submission.

CREATE TABLE contact_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('linkedin_message', 'call', 'mail_letter')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  subject text,
  content text NOT NULL,
  asset_path text,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contact_tasks_contact_id_idx ON contact_tasks(contact_id);
CREATE INDEX contact_tasks_organization_id_idx ON contact_tasks(organization_id);
CREATE INDEX contact_tasks_status_due_at_idx ON contact_tasks(status, due_at);

ALTER TABLE contact_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_tasks_org_isolation ON contact_tasks
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- Public-schema default ACLs auto-grant anon/authenticated full CRUD on new tables
-- (see benavora-public-schema-default-acl-anon-exposure project precedent) - revoke
-- explicitly rather than relying on RLS alone to keep this table off the anon surface.
REVOKE ALL ON contact_tasks FROM anon;
REVOKE ALL ON contact_tasks FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_tasks TO authenticated;
