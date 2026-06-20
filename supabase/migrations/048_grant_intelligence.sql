-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Funded proposals
CREATE TABLE IF NOT EXISTS intelligence_funded_proposals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  source_url text,
  funder_name text,
  funder_type text,
  grant_program text,
  award_amount numeric(12,2),
  award_year integer,
  category text[],
  full_text text,
  reviewer_comments text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT NOW()
);

-- Proposal sections with embeddings
CREATE TABLE IF NOT EXISTS intelligence_proposal_sections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id uuid REFERENCES intelligence_funded_proposals(id) ON DELETE CASCADE,
  section_type text NOT NULL,
  section_text text NOT NULL,
  quality_score numeric(3,1),
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW()
);

-- Scoring rubrics
CREATE TABLE IF NOT EXISTS intelligence_scoring_rubrics (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  source_url text,
  funder_name text,
  grant_program text,
  category text[],
  dimensions jsonb NOT NULL,
  full_text text,
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW()
);

-- Logic models
CREATE TABLE IF NOT EXISTS intelligence_logic_models (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  subcategory text,
  inputs jsonb NOT NULL,
  activities jsonb NOT NULL,
  outputs jsonb NOT NULL,
  outcomes jsonb NOT NULL,
  impact jsonb NOT NULL,
  source text,
  is_template boolean DEFAULT true,
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW()
);

-- Need statement data
CREATE TABLE IF NOT EXISTS intelligence_need_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  source_url text,
  data_type text NOT NULL,
  geographic_level text NOT NULL,
  state text,
  county text,
  city text,
  zip text,
  metric_name text NOT NULL,
  metric_value text NOT NULL,
  metric_year integer,
  context text,
  citation text NOT NULL,
  raw_data jsonb,
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- Narrative patterns
CREATE TABLE IF NOT EXISTS intelligence_narrative_patterns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern_type text NOT NULL,
  category text[],
  structure jsonb NOT NULL,
  example_ids uuid[],
  frequency integer DEFAULT 1,
  win_rate numeric(5,2),
  description text,
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW()
);

-- Budget templates
CREATE TABLE IF NOT EXISTS intelligence_budget_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  budget_category text NOT NULL,
  subcategory text,
  justification_template text NOT NULL,
  federal_reference text,
  example_language text,
  source text,
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW()
);

-- Evaluation frameworks
CREATE TABLE IF NOT EXISTS intelligence_evaluation_frameworks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  framework_name text,
  kpis jsonb NOT NULL,
  data_collection_methods jsonb,
  reporting_frequency text,
  example_text text,
  source text,
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW()
);

-- Grantmaker profiles
CREATE TABLE IF NOT EXISTS intelligence_grantmaker_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  funder_id uuid REFERENCES funders(id),
  ein text,
  priorities text[],
  avg_award_amount numeric(12,2),
  award_range_min numeric(12,2),
  award_range_max numeric(12,2),
  geographic_focus text[],
  typical_language text,
  common_keywords text[],
  decision_timeline text,
  application_tips text,
  source text,
  last_updated_at timestamptz DEFAULT NOW(),
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW()
);

-- Post-award reports
CREATE TABLE IF NOT EXISTS intelligence_post_award_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  source_url text,
  funder_name text,
  grantee_name text,
  category text[],
  highlighted_outcomes text,
  reported_metrics jsonb,
  funder_language text,
  follow_on_funding boolean,
  full_text text,
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW()
);

-- Grant DNA scores
CREATE TABLE IF NOT EXISTS intelligence_grant_dna_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id uuid REFERENCES intelligence_funded_proposals(id) ON DELETE CASCADE,
  need_statement_score numeric(3,1),
  evidence_strength_score numeric(3,1),
  outcome_specificity_score numeric(3,1),
  evaluation_depth_score numeric(3,1),
  sustainability_score numeric(3,1),
  budget_alignment_score numeric(3,1),
  program_design_score numeric(3,1),
  reviewer_friendliness_score numeric(3,1),
  composite_score numeric(3,1),
  scoring_rationale jsonb,
  created_at timestamptz DEFAULT NOW()
);

-- Vector similarity search index
CREATE INDEX IF NOT EXISTS idx_proposal_sections_embedding
  ON intelligence_proposal_sections USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_rubrics_embedding
  ON intelligence_scoring_rubrics USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_need_data_geo
  ON intelligence_need_data (geographic_level, state, county);

-- NOTE: This migration must be applied manually via the Supabase SQL Editor.
-- pgvector may need to be enabled first via the Supabase dashboard under Database > Extensions.
