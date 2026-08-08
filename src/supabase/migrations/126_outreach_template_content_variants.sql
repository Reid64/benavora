-- 126_outreach_template_content_variants.sql — Donor Personalization Engine MVP (row #221),
-- scoped down per the queue-37 preflight (SESSION_STATE.md): no visitor-type detection signal
-- exists anywhere in this repo (confirmed by grep — no visitors table, no UTM/referrer capture,
-- no session-tracking column anywhere in src/ or the migrations; AGENTS_v2.md AG-34's own
-- `visitor_personas` table was never built). Building real visitor detection would mean building
-- a whole new signal-capture system from scratch, explicitly out of scope for this pass. This
-- migration instead builds the scoped-down version: an org-configurable content-variant toggle
-- (an admin defines 2-3 named variants for a real donor/prospect-facing template and picks which
-- one is active), not ML-driven personalization.
--
-- Real existing surface: outreach_templates (src/app/(dashboard)/outreach/templates/page.tsx +
-- src/app/api/outreach/templates/route.ts) — a real, fully-wired UI+API for the org's reusable
-- multi-channel (email/LinkedIn/phone/mail) donor-and-prospect-facing outreach content. Confirmed
-- via a live psql check this session that this table itself was never applied to production
-- (defined only in the root supabase/migrations/082_outreach_templates.sql tree, which per
-- project memory `benavora-two-parallel-migrations-directories` is not the tree recent sessions
-- have been applying — src/supabase/migrations/ is, per SESSION_STATE.md's own note on migration
-- 125). The UI and API code are already real and already match this exact schema unmodified, so
-- rather than invent a new page to attach the variant toggle to, this migration supplies the
-- missing live table for the surface that already exists, then adds the variant capability on
-- top of it.
--
-- Per this project's known public-schema default-ACL gap (every new table is anon/authenticated-
-- exposed by default unless explicitly locked down — see ANON_GRANT_AUDIT.md and the many
-- *_rls_hardening.sql migrations in this tree), RLS + REVOKE are added in this same migration.

CREATE TABLE IF NOT EXISTS outreach_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  channel           text NOT NULL CHECK (channel IN ('email', 'linkedin', 'phone_script', 'physical_mail')),
  subject           text,
  body              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_templates_org ON outreach_templates (organization_id);
CREATE INDEX IF NOT EXISTS idx_outreach_templates_channel ON outreach_templates (organization_id, channel);

-- outreach_template_variants — 2-3 named content variants per template
-- (e.g. "Standard", "Warm", "Formal"). Purely additive: outreach_templates.subject/body remain
-- the content actually used everywhere today (Cold Outreach, campaign send paths) until a human
-- explicitly marks a variant active for a given template via this table's is_active flag — this
-- migration does not rewire any existing send path, it only adds the org-facing toggle surface
-- and a resolved-content read (src/app/api/outreach/templates/route.ts GET now also returns each
-- template's active variant, if any, alongside the base content).
CREATE TABLE outreach_template_variants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       uuid NOT NULL REFERENCES outreach_templates(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  variant_name      text NOT NULL,
  subject_override  text,
  body_override     text NOT NULL,
  is_active         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outreach_template_variants_template ON outreach_template_variants (template_id);
CREATE INDEX idx_outreach_template_variants_org ON outreach_template_variants (organization_id);

-- At most one active variant per template — the actual "toggle" invariant. A second activation
-- must deactivate the previous one first (enforced at the API layer, matching this project's
-- existing convention of RLS enforcing the org boundary and the route enforcing state-machine
-- correctness — same pattern used for marketplace_matches in migration 125).
CREATE UNIQUE INDEX idx_outreach_template_variants_one_active
  ON outreach_template_variants (template_id)
  WHERE is_active;

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outreach_templates FROM anon;

CREATE POLICY outreach_templates_org ON outreach_templates FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE outreach_template_variants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outreach_template_variants FROM anon;

CREATE POLICY outreach_template_variants_org ON outreach_template_variants FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
