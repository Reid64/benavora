-- Migration 181 — email_security_audit_log + pii_mask_log (Phase 6.1,
-- QUEUE-PHASE6-1: Email Security & Authentication).
--
-- email_security_audit_log: one row per inbound email processed by the
-- security pipeline (SPF/DKIM/DMARC/phishing/attachment/risk), independent of
-- whether the email was accepted, flagged, or blocked. Append-only.
--
-- pii_mask_log: records that a PII value was detected and masked, storing
-- only a SHA-256 hash of the original value — never the raw PII itself
-- (QUEUE-PHASE6-1 6.1.7: "NO raw PII in logs").

-- ---------------------------------------------------------------------------
-- email_security_audit_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_security_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  sender_domain     text,
  sender_email      text,
  spf_pass          boolean,
  spf_policy_type   text,
  dkim_valid        boolean,
  dkim_key_length   integer,
  dmarc_pass        boolean,
  dmarc_policy      text,
  phishing_score    numeric(4,3),
  phishing_indicators jsonb NOT NULL DEFAULT '[]',
  attachment_scans  jsonb NOT NULL DEFAULT '[]',
  sender_risk_level text        NOT NULL CHECK (sender_risk_level IN ('SAFE', 'CAUTION', 'BLOCK')),
  action_taken      text        NOT NULL CHECK (action_taken IN ('accepted', 'flagged', 'blocked')),
  thread_id         text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_security_audit_log_organization_id_idx
  ON public.email_security_audit_log (organization_id);

CREATE INDEX IF NOT EXISTS email_security_audit_log_risk_level_idx
  ON public.email_security_audit_log (sender_risk_level);

CREATE INDEX IF NOT EXISTS email_security_audit_log_created_at_idx
  ON public.email_security_audit_log (created_at DESC);

ALTER TABLE public.email_security_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_security_audit_log: org members can select"
  ON public.email_security_audit_log FOR SELECT
  TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "email_security_audit_log: org members can insert"
  ON public.email_security_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = current_org_id());

-- No UPDATE, no DELETE — append-only audit trail.

-- ---------------------------------------------------------------------------
-- pii_mask_log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pii_mask_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  email_security_audit_id uuid REFERENCES public.email_security_audit_log(id) ON DELETE CASCADE,
  pii_type               text        NOT NULL CHECK (pii_type IN ('email', 'phone', 'ssn', 'creditcard', 'password', 'apikey')),
  value_hash             text        NOT NULL,
  masked_value           text        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pii_mask_log_organization_id_idx
  ON public.pii_mask_log (organization_id);

CREATE INDEX IF NOT EXISTS pii_mask_log_audit_id_idx
  ON public.pii_mask_log (email_security_audit_id);

ALTER TABLE public.pii_mask_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pii_mask_log: org members can select"
  ON public.pii_mask_log FOR SELECT
  TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "pii_mask_log: org members can insert"
  ON public.pii_mask_log FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = current_org_id());

-- No UPDATE, no DELETE — append-only. A masked hash record is never
-- meaningful to revise; if the masking logic changes, new rows are written.
