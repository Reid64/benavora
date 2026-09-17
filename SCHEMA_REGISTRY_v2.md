# BENAVORA — Schema Registry v2.0
## Supersedes: SCHEMA_REGISTRY.md v1.0
## Date: July 17, 2026
## Status: CANONICAL — All migrations listed here are the authoritative source of truth.
## Current migration count: 097 applied or queued

---

## Migration Strategy

Migrations are sequential, idempotent, and applied via the Supabase Management API:
```
POST https://api.supabase.com/v1/projects/vbjplpquqxxfbpazyalt/database/query
Authorization: Bearer sbp_a63596024b79b5964d2dc2971ac9d4cc77a112c1
Content-Type: application/json
Body: {"query": "SQL_HERE"}
```

Rules:
- All DDL uses `IF NOT EXISTS`
- All indexes use `IF NOT EXISTS`
- Non-ASCII characters are forbidden — Supabase Management API rejects them
- Split large SQL into separate statements to avoid payload limits
- Never use `&&` in PowerShell — use semicolons

---

## Enums (Migration 001)

```sql
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'writer', 'viewer');
CREATE TYPE funder_category AS ENUM (
  'corporate_donation', 'corporate_sponsorship', 'corporate_foundation',
  'private_foundation', 'government_grant', 'local_community_grant',
  'housing_grant', 'education_grant', 'faith_compatible_grant',
  'in_kind_donation', 'materials_donation', 'down_payment_assistance'
);
CREATE TYPE pipeline_stage AS ENUM (
  'discovered', 'eligibility_review', 'qualified', 'drafting',
  'awaiting_documents', 'ready_for_review', 'submitted',
  'follow_up_due', 'awarded', 'denied', 'reporting_required',
  'renewal_opportunity'
);
CREATE TYPE outcome_result AS ENUM ('awarded', 'denied', 'partial');
CREATE TYPE document_category AS ENUM (
  'tax_documents', 'legal_documents', 'financial_documents',
  'program_documents', 'marketing_materials', 'letters_of_support',
  'application_attachments', 'photos'
);
CREATE TYPE deadline_type AS ENUM (
  'application_deadline', 'follow_up_date', 'reporting_deadline',
  'renewal_date', 'document_expiration'
);
CREATE TYPE draft_template_type AS ENUM (
  'grant_narrative', 'donation_request_letter', 'budget_narrative',
  'impact_statement', 'letter_of_inquiry', 'full_proposal'
);
CREATE TYPE contact_relationship AS ENUM ('cold', 'warm', 'active', 'champion');
CREATE TYPE opportunity_status AS ENUM ('open', 'applied', 'closed', 'expired');
CREATE TYPE knowledge_base_category AS ENUM (
  'mission', 'vision', 'need_statement', 'program_description',
  'impact', 'capacity', 'sustainability', 'partnerships',
  'budget_justification', 'organizational_history', 'custom'
);
CREATE TYPE agent_run_status AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'completed');
CREATE TYPE campaign_step_status AS ENUM ('pending', 'sent', 'opened', 'replied', 'bounced');
```

---

## RLS Master Policy Pattern

All org-scoped tables use:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "<table>_org_isolation" ON <table>
  USING (organization_id = (
    SELECT organization_id FROM profiles WHERE id = auth.uid()
  ));
```

Shared tables (foundation_directory, corporate_prospects, intelligence_funded_proposals, pig_nodes, pig_edges, disaster_declarations) use read-only RLS or are service-role only.

---

## Tables — Core Tenant (Migrations 001-030)

### 1. organizations
Primary tenant entity. All other org-scoped tables reference this.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| name | text NOT NULL | Legal name |
| dba | text | Doing business as |
| ein | text | EIN |
| tax_status | text | e.g. 501(c)(3), 508(c)(1)(a) |
| mission_statement | text | |
| vision_statement | text | |
| founding_date | date | |
| founder_name | text | |
| founder_bio | text | |
| service_area | text | Geographic coverage |
| service_areas | text[] | Array of service areas |
| target_population | text | |
| annual_budget | numeric(12,2) | |
| total_staff | integer DEFAULT 0 | |
| total_volunteers | integer DEFAULT 0 | |
| website | text | |
| phone | text | |
| email | text | |
| address_line1 | text | |
| address_line2 | text | |
| city | text | |
| state | text | |
| zip | text | |
| logo_url | text | Supabase Storage path |
| stripe_customer_id | text | |
| stripe_subscription_id | text | |
| stripe_subscription_status | text | |
| subscription_tier | text DEFAULT 'free' | starter/professional/enterprise |
| onboarding_completed | boolean DEFAULT false | Controls middleware gate |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_organizations_ein ON (ein)

### 2. profiles
User profiles linked to Supabase Auth.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | REFERENCES auth.users(id) ON DELETE CASCADE |
| organization_id | uuid NOT NULL | FK → organizations(id) |
| email | text NOT NULL | |
| full_name | text | |
| role | user_role NOT NULL DEFAULT 'viewer' | |
| avatar_url | text | |
| last_login_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_profiles_org ON (organization_id), idx_profiles_email ON (email)

### 3. funders
Corporations, foundations, and agencies tracked per org.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | FK → organizations(id) |
| name | text NOT NULL | |
| category | funder_category NOT NULL | |
| description | text | |
| website | text | |
| giving_portal_url | text | |
| portal_login_status | text | has_account/needs_account/no_portal |
| annual_giving_budget | numeric(12,2) | |
| geographic_focus | text | |
| preferred_application_method | text | |
| has_giving_page | boolean DEFAULT true | |
| notes | text | |
| last_contacted_at | timestamptz | |
| relationship_score | numeric | 0-100, from relationship scorer |
| relationship_momentum | text | rising/stable/declining |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_funders_org, idx_funders_category, idx_funders_name

### 4. contacts
People at funder organizations.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| funder_id | uuid NOT NULL | FK → funders(id) ON DELETE CASCADE |
| name | text NOT NULL | |
| title | text | |
| email | text | |
| phone | text | |
| preferred_contact_method | text | |
| relationship | contact_relationship DEFAULT 'cold' | |
| last_contacted_at | timestamptz | |
| notes | text | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 5. opportunities
Grants, donation programs, sponsorships.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| funder_id | uuid | FK → funders(id) ON DELETE SET NULL |
| name | text NOT NULL | |
| category | funder_category NOT NULL | |
| description | text | |
| amount_available | numeric(12,2) | |
| amount_min | numeric(12,2) | |
| amount_max | numeric(12,2) | |
| deadline | timestamptz | |
| url | text | |
| eligibility_requirements | text | |
| required_documents | text[] | |
| application_method | text | |
| recurrence | text | one_time/annual/quarterly/rolling |
| geographic_restrictions | text | |
| eligibility_score | integer CHECK (0-100) | Set by Eligibility Agent |
| probability_score | integer CHECK (0-100) | Set by Probability Engine |
| probability_confidence | text | high/medium/low |
| probability_recommendation | text | apply/consider/skip |
| recommendation | text | apply/skip/review |
| recommendation_reasoning | text | |
| status | opportunity_status DEFAULT 'open' | |
| source | text | manual/agent/discovery |
| external_id | text | For dedup from external sources |
| discovered_at | timestamptz DEFAULT now() | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_opportunities_org, idx_opportunities_funder, idx_opportunities_category, idx_opportunities_deadline, idx_opportunities_status, idx_opportunities_probability ON (probability_score DESC)

### 6. opportunity_keywords
Tags on opportunities.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| opportunity_id | uuid NOT NULL | FK → opportunities(id) ON DELETE CASCADE |
| keyword | text NOT NULL | |

### 7. applications
Grant applications in the 12-stage pipeline.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| opportunity_id | uuid | FK → opportunities(id) ON DELETE SET NULL |
| funder_id | uuid | FK → funders(id) ON DELETE SET NULL |
| stage | pipeline_stage DEFAULT 'discovered' | |
| requested_amount | numeric(12,2) | |
| draft_content | text | Current draft narrative |
| draft_confidence_score | integer | AI confidence 0-100 |
| notes | text | |
| submitted_at | timestamptz | |
| portal_submission_url | text | |
| cloned_from_id | uuid | FK → applications(id) — source if cloned |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_applications_org, idx_applications_stage, idx_applications_funder

### 8. application_stage_history
Audit trail of stage transitions.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | FK → applications(id) ON DELETE CASCADE |
| from_stage | pipeline_stage | |
| to_stage | pipeline_stage NOT NULL | |
| changed_by | uuid | FK → profiles(id) |
| notes | text | |
| created_at | timestamptz DEFAULT now() | |

### 9. documents
File repository per organization.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| name | text NOT NULL | |
| category | document_category NOT NULL | |
| storage_path | text NOT NULL | Supabase Storage path |
| file_size | integer | Bytes |
| mime_type | text | |
| expiration_date | date | |
| is_expired | boolean DEFAULT false | |
| uploaded_by | uuid | FK → profiles(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 10. application_documents
Junction: documents attached to applications.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | FK → applications(id) ON DELETE CASCADE |
| document_id | uuid NOT NULL | FK → documents(id) ON DELETE CASCADE |
| created_at | timestamptz DEFAULT now() | |

### 11. knowledge_base
Reusable narrative blocks and standard answers.

> **Correction (AR-2.1, 2026-09-17):** This table's real name in
> `supabase/migrations/001_initial_schema.sql` is `knowledge_base`, not
> `knowledge_base_entries` as this doc previously said. That mismatch was not
> just a documentation error — `src/lib/autoapply/form-filler-agent.ts`,
> `src/app/api/autoapply/templates/test/route.ts`, and
> `src/lib/autoapply/org-profile-mapper.ts` all queried the nonexistent
> `knowledge_base_entries` name (inside try/catch, so it failed silently),
> which is why 14 of 16 fill keys in `buildFillData()` were permanently
> empty. Fixed to query `knowledge_base` in all three files. Real columns
> confirmed against the migration: `id, organization_id, category, title,
> content, is_proven, proven_count, funder_categories, keywords, version,
> created_by, created_at, updated_at` — note `funder_categories` (plural,
> array), not `funder_types` as the table below still lists; not corrected
> further here since no live call site referenced that column name.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| title | text NOT NULL | |
| content | text NOT NULL | |
| category | knowledge_base_category NOT NULL | |
| is_proven | boolean DEFAULT false | Set by learning agent |
| proven_count | integer DEFAULT 0 | Times used in awarded applications |
| funder_types | funder_category[] | Which funder types this works for |
| created_by | uuid | FK → profiles(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 12. drafts
AI-generated draft versions per application.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | FK → applications(id) ON DELETE CASCADE |
| organization_id | uuid NOT NULL | |
| template_type | draft_template_type NOT NULL | |
| content | text NOT NULL | Generated text |
| confidence_score | integer | 0-100 |
| kb_entries_used | uuid[] | Knowledge base entries referenced |
| model_used | text | claude-sonnet-4-6 |
| tokens_used | integer | |
| version | integer DEFAULT 1 | Increments on regeneration |
| created_at | timestamptz DEFAULT now() | |

### 13. outcomes
Recorded results per application.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| application_id | uuid NOT NULL | FK → applications(id) |
| result | outcome_result NOT NULL | awarded/denied/partial |
| awarded_amount | numeric(12,2) | If awarded or partial |
| requested_amount | numeric(12,2) | Snapshot at time of outcome |
| funder_category | funder_category | Snapshot for analytics |
| opportunity_category | text | |
| denial_reason | text | |
| funder_feedback | text | |
| recorded_at | timestamptz DEFAULT now() | |
| created_at | timestamptz DEFAULT now() | |

### 14. alerts
In-app notification system.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| user_id | uuid | FK → profiles(id), null = all org users |
| title | text NOT NULL | |
| message | text | |
| alert_type | text | deadline/opportunity/system/agent/reputation |
| severity | text DEFAULT 'info' | info/warning/error/success |
| entity_type | text | What triggered this |
| entity_id | uuid | FK to triggering entity |
| is_read | boolean DEFAULT false | |
| read_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_alerts_org ON (organization_id, is_read)

### 15. deadlines
All time-sensitive items.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| application_id | uuid | FK → applications(id) |
| opportunity_id | uuid | FK → opportunities(id) |
| deadline_type | deadline_type NOT NULL | |
| due_date | date NOT NULL | |
| title | text NOT NULL | |
| description | text | |
| is_completed | boolean DEFAULT false | |
| completed_at | timestamptz | |
| reminder_30d_sent | boolean DEFAULT false | |
| reminder_14d_sent | boolean DEFAULT false | |
| reminder_7d_sent | boolean DEFAULT false | |
| reminder_3d_sent | boolean DEFAULT false | |
| reminder_1d_sent | boolean DEFAULT false | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 16. notes
Polymorphic notes (funder, opportunity, or application).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| funder_id | uuid | FK → funders(id) ON DELETE CASCADE |
| opportunity_id | uuid | FK → opportunities(id) ON DELETE CASCADE |
| application_id | uuid | FK → applications(id) ON DELETE CASCADE |
| content | text NOT NULL | |
| author_id | uuid | FK → profiles(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Constraint:** Exactly one of funder_id, opportunity_id, application_id must be non-null.

### 17. search_profiles
Saved keyword configurations.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| name | text NOT NULL | |
| keywords | text[] NOT NULL | |
| categories | funder_category[] | |
| geographic_scope | text | |
| min_amount | numeric(12,2) | |
| max_amount | numeric(12,2) | |
| recurrence_preference | text | |
| is_active | boolean DEFAULT true | |
| last_run_at | timestamptz | |
| results_count | integer DEFAULT 0 | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 18. outreach_contacts
Extracted contacts for cold outreach.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| company_name | text NOT NULL | |
| contact_name | text | |
| email | text | |
| phone | text | |
| contact_form_url | text | |
| source_url | text | |
| company_type | text | |
| giving_likelihood | text | high/medium/low |
| campaign_id | uuid | FK → email_campaigns(id) |
| status | text DEFAULT 'new' | |
| converted_to_funder_id | uuid | FK → funders(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 19. email_campaigns
Drip campaign definitions.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| name | text NOT NULL | |
| status | campaign_status DEFAULT 'draft' | |
| total_steps | integer DEFAULT 0 | |
| total_contacts | integer DEFAULT 0 | |
| created_by | uuid | FK → profiles(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 20. campaign_steps
Individual emails in drip sequence.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| campaign_id | uuid NOT NULL | FK → email_campaigns(id) ON DELETE CASCADE |
| step_number | integer NOT NULL | |
| subject_template | text NOT NULL | |
| body_template | text NOT NULL | |
| delay_days | integer NOT NULL DEFAULT 0 | |
| created_at | timestamptz DEFAULT now() | |

### 21. campaign_sends
Individual email send tracking.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| campaign_step_id | uuid NOT NULL | FK → campaign_steps(id) |
| outreach_contact_id | uuid NOT NULL | FK → outreach_contacts(id) |
| status | campaign_step_status DEFAULT 'pending' | |
| sent_at | timestamptz | |
| opened_at | timestamptz | |
| replied_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

### 22. agent_runs
All agent execution logs.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| agent_type | text NOT NULL | Extended beyond original enum |
| status | agent_run_status DEFAULT 'pending' | |
| input_params | jsonb | |
| output_summary | text | |
| items_found | integer DEFAULT 0 | |
| items_processed | integer DEFAULT 0 | |
| error_message | text | |
| tokens_used | integer | |
| duration_ms | integer | |
| triggered_by | uuid | FK → profiles(id), null if automated |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_agent_runs_org, idx_agent_runs_type, idx_agent_runs_status

### 23. platform_config
Feature flags per org.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| key | text NOT NULL | |
| value | text NOT NULL | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Unique:** (organization_id, key)

---

## Tables — Shared Intelligence (Migrations 031-060)

### 24. foundation_directory
133,812+ foundation records. Shared across all orgs.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| ein | text UNIQUE | IRS Employer ID |
| name | text NOT NULL | |
| city | text | |
| state | text | |
| zip | text | |
| ntee_code | text | National Taxonomy of Exempt Entities |
| subsection_code | text | IRS subsection |
| foundation_type | text | |
| ruling_date | text | IRS ruling date |
| asset_amount | numeric | From IRS data |
| income_amount | numeric | |
| revenue_amount | numeric | |
| website_url | text | |
| enrichment | jsonb DEFAULT '{}' | All enrichment fields |
| enrichment_version | integer DEFAULT 0 | |
| enrichment_completed_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_foundation_directory_ein, idx_foundation_directory_state, idx_foundation_directory_ntee, idx_foundation_directory_enrichment (GIN)

### 25. foundation_profiles
Computed analytical profiles per foundation.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| foundation_id | uuid UNIQUE | FK → foundation_directory(id) ON DELETE CASCADE |
| avg_grant_size | numeric | |
| geographic_focus | text[] | |
| funding_categories | text[] | |
| total_grants_made | numeric | |
| top_recipients | jsonb | |
| computed_at | timestamptz DEFAULT now() | |

### 26. intelligence_funded_proposals
Corpus of funded grant proposals for the Knowledge Engine.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| title | text NOT NULL | |
| abstract | text | |
| funder_name | text | |
| agency | text | |
| award_amount | numeric | |
| fiscal_year | integer | |
| organization | text | Recipient org name |
| source | text NOT NULL | NIH_NIAID/NIH_REPORTER/NSF_AWARDS/etc |
| source_url | text UNIQUE | For dedup |
| narrative_sections | jsonb DEFAULT '{}' | Parsed narrative components |
| embedding | vector(1536) | pgvector — populated by indexer agent |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_proposals_source, idx_proposals_funder, idx_proposals_embedding (ivfflat)

**Dedup rule:** WHERE NOT EXISTS on source_url before every insert.

### 27. intelligence_proposal_sections
Parsed sections from funded proposals.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| proposal_id | uuid NOT NULL | FK → intelligence_funded_proposals(id) ON DELETE CASCADE |
| section_type | text NOT NULL | need_statement/narrative/budget/evaluation/etc |
| content | text NOT NULL | |
| word_count | integer | |
| created_at | timestamptz DEFAULT now() | |

**Unique:** (proposal_id, section_type)

### 28. knowledge_patterns
Aggregated funding success patterns.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| pattern_type | text NOT NULL | narrative/budget/timing/competitive/funder |
| category | text | funder category or NTEE |
| funder_name | text | Specific funder if applicable |
| pattern_description | text NOT NULL | |
| success_rate | numeric | 0-1 |
| sample_count | integer | Records this is based on |
| confidence | text DEFAULT 'low' | low/medium/high |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 29. knowledge_queries
Log of all Knowledge Engine queries.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| query_text | text NOT NULL | |
| results | jsonb | |
| created_at | timestamptz DEFAULT now() | |

---

## Tables — AutoApply (Migrations 040-055)

### 30. submission_queue
AutoApply job queue.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| application_id | uuid | FK → applications(id) |
| funder_name | text | |
| portal_url | text | |
| status | text DEFAULT 'queued' | queued/processing/completed/failed/needs_review |
| session_id | text | Playwright session ID |
| screenshot_url | text | Confirmation screenshot |
| error_message | text | |
| requires_human_approval | boolean DEFAULT false | |
| approved_by | uuid | FK → profiles(id) |
| approved_at | timestamptz | |
| submitted_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 31. form_analyses
Cached form analysis results from AutoApply.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| portal_url | text UNIQUE | |
| form_fields | jsonb | Detected fields and types |
| requires_captcha | boolean DEFAULT false | |
| captcha_type | text | |
| analyzed_at | timestamptz DEFAULT now() | |

---

## Tables — Donor Discovery (Migrations 056-075)

### 32. donor_discovery_taxonomy
NAICS taxonomy for business classification.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| naics_code | text UNIQUE NOT NULL | |
| title | text NOT NULL | Official NAICS title |
| friendly_name | text | Consumer-friendly plain English name |
| category | text | Sector grouping |
| level | integer | 2=sector, 3=subsector, 4=group, 5=industry, 6=national |
| parent_code | text | |
| created_at | timestamptz DEFAULT now() | |

### 33. donor_discovery_directory
Corporate prospect records discovered via Donor Discovery.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | Discovering org (tenant-scoped) |
| name | text NOT NULL | |
| naics_code | text | |
| address | text | |
| city | text | |
| state | text | |
| zip | text | |
| latitude | numeric | |
| longitude | numeric | |
| phone | text | |
| website | text | |
| google_place_id | text | |
| rating | numeric | Google rating |
| enrichment | jsonb DEFAULT '{}' | All enrichment data |
| scores | jsonb DEFAULT '{}' | All propensity scores |
| enrichment_completed_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 34. donor_discovery_requests
Discovery run requests per org.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| naics_code | text | |
| radius_miles | integer | |
| keywords | text[] | |
| status | text DEFAULT 'pending' | |
| prospects_found | integer DEFAULT 0 | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 35. donor_discovery_aliases
Alternative name mappings for NAICS codes.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| naics_code | text NOT NULL | |
| alias | text NOT NULL | Plain English synonym |
| created_at | timestamptz DEFAULT now() | |

---

## Tables — Corporate Intelligence Engine (Migrations 076-085)

### 36. corporate_prospects
Master corporate intelligence table. Shared across all orgs. Tens of millions of records at scale.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| legal_name | text NOT NULL | |
| dba_name | text | |
| ein | text | |
| duns_number | text | |
| website | text | |
| phone | text | |
| email | text | |
| address_street | text | |
| address_city | text | |
| address_state | text | |
| address_zip | text | |
| address_lat | numeric | |
| address_lng | numeric | |
| naics_code | text | |
| naics_description | text | |
| sic_code | text | |
| industry_category | text | |
| employee_count_estimate | text | 1-10/11-50/51-200/201-500/500+ |
| revenue_estimate | text | <1M/1M-10M/10M-50M/50M+ |
| location_count | integer | |
| geographic_footprint | text[] | States of operation |
| ownership_type | text | public/private/nonprofit/government |
| is_family_owned | boolean | |
| is_veteran_owned | boolean | |
| is_minority_owned | boolean | |
| is_woman_owned | boolean | |
| parent_company_id | uuid | FK → corporate_prospects(id) |
| source_adapters | text[] | Which sources found this record |
| first_seen_at | timestamptz DEFAULT now() | |
| last_verified_at | timestamptz | |
| enrichment | jsonb DEFAULT '{}' | All 40+ enrichment fields from 10 agents |
| enrichment_version | integer DEFAULT 0 | |
| enrichment_started_at | timestamptz | |
| enrichment_completed_at | timestamptz | |
| scores | jsonb DEFAULT '{}' | PS-01 through PS-10 propensity scores |
| scores_computed_at | timestamptz | |
| giving_dna | jsonb DEFAULT '{}' | Corporate Giving DNA profile |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Unique:** (legal_name, address_city, address_state)
**Indexes:** idx_corporate_prospects_naics, idx_corporate_prospects_state, idx_corporate_prospects_scores (GIN), idx_corporate_prospects_enrichment (GIN)

### 37. corporate_relationships
Relationship edges between corporate entities.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| source_company_id | uuid | FK → corporate_prospects(id) |
| target_company_id | uuid | FK → corporate_prospects(id) |
| relationship_type | text NOT NULL | parent/subsidiary/supplier/board_overlap/foundation |
| confidence | numeric DEFAULT 0.5 | 0-1 |
| evidence | text | |
| discovered_at | timestamptz DEFAULT now() | |

**Unique:** (source_company_id, target_company_id, relationship_type)

### 38. corporate_relationship_people
People linked to multiple companies.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid | FK → corporate_prospects(id) |
| person_name | text NOT NULL | |
| person_title | text | |
| board_memberships | text[] | |
| foundation_roles | text[] | |
| linkedin_url | text | |
| discovered_at | timestamptz DEFAULT now() | |

### 39. corporate_enrichment_queue
Job queue for enrichment agents.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| prospect_id | uuid NOT NULL | FK → corporate_prospects(id) |
| agent_id | text NOT NULL | EA-01 through EA-10 |
| status | text DEFAULT 'pending' | |
| attempts | integer DEFAULT 0 | |
| error | text | |
| created_at | timestamptz DEFAULT now() | |
| processed_at | timestamptz | |

### 40. corporate_monitoring_events
Change detection log.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| prospect_id | uuid NOT NULL | FK → corporate_prospects(id) |
| event_type | text NOT NULL | exec_change/acquisition/new_location/press_release/donation |
| description | text | |
| change_detected | jsonb DEFAULT '{}' | Before/after comparison |
| created_at | timestamptz DEFAULT now() | |

---

## Tables — Financial Reconciliation (Migration 085-087)

### 41. grant_budgets
Budget per application.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| line_items | jsonb NOT NULL DEFAULT '[]' | [{category, description, amount, justification}] |
| total_requested | numeric DEFAULT 0 | |
| total_approved | numeric | Set after award |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 42. grant_expenses
Actual expenses against awarded grants.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| category | text NOT NULL | |
| description | text NOT NULL | |
| amount | numeric NOT NULL | |
| expense_date | date | |
| receipt_url | text | Supabase Storage path |
| created_at | timestamptz DEFAULT now() | |

### 43. grant_reconciliation_reports
Computed budget vs actual reports.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| total_budget | numeric | |
| total_spent | numeric | |
| variance | numeric | budget - spent (positive = under budget) |
| compliance_status | text | compliant/over_budget/under_spent |
| generated_at | timestamptz DEFAULT now() | |

---

## Tables — Compliance + White-Label (Migrations 087-090)

### 44. compliance_events
Compliance calendar items.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| application_id | uuid | |
| event_type | text NOT NULL | Report/Audit/Renewal/Meeting/Filing |
| title | text NOT NULL | |
| due_date | date NOT NULL | |
| recurrence | text | monthly/quarterly/annual |
| completed_at | timestamptz | |
| notes | text | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_compliance_events_org_due ON (org_id, due_date)

### 45. consultant_client_access
White-label consultant org access.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| consultant_org_id | uuid NOT NULL | FK → organizations(id) |
| client_org_id | uuid NOT NULL | FK → organizations(id) |
| access_level | text DEFAULT 'read' | read/write/admin |
| granted_at | timestamptz DEFAULT now() | |
| active | boolean DEFAULT true | |

**Unique:** (consultant_org_id, client_org_id)

### 46. notification_preferences
Per-user notification settings.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| event_type | text NOT NULL | |
| in_app | boolean DEFAULT true | |
| email | boolean DEFAULT false | |

**Unique:** (user_id, org_id, event_type)

### 47. funder_relationship_events
Events in funder relationship history.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| funder_id | uuid NOT NULL | |
| event_type | text NOT NULL CHECK IN ('award','application','response','outreach','meeting','rejection') | |
| event_date | timestamptz DEFAULT now() | |
| notes | text | |

### 48. funder_relationship_scores
Computed relationship scores per org-funder pair.

| Column | Type | Notes |
|---|---|---|
| funder_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| score | numeric DEFAULT 0 | 0-100 |
| momentum | text DEFAULT 'stable' | rising/stable/declining |
| computed_at | timestamptz DEFAULT now() | |

**Primary Key:** (funder_id, org_id)

---

## Tables — Platform Vision Phase 1 (Migrations 091-097)

### 49. organizational_digital_twins
AI model of each nonprofit org.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL UNIQUE | |
| mission | text | |
| vision | text | |
| service_areas | text[] | |
| programs | jsonb DEFAULT '[]' | [{name, description, population, outcomes}] |
| financial_profile | jsonb DEFAULT '{}' | Budget, revenue sources, expenses |
| board_composition | jsonb DEFAULT '[]' | Board member records |
| proven_narrative_patterns | text[] | From successful grants |
| key_strengths | text[] | |
| known_weaknesses | text[] | |
| twin_completeness_score | integer DEFAULT 0 | 0-100 |
| last_rebuilt_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 50. opportunity_probability_scores
Grant probability scores per org-opportunity pair.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| opportunity_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| overall_score | integer DEFAULT 0 | 0-100 |
| confidence | text DEFAULT 'low' | high/medium/low |
| factors | jsonb DEFAULT '[]' | [{name, weight, value, contribution}] |
| recommendation | text DEFAULT 'consider' | apply/consider/skip |
| key_risks | text[] | |
| key_strengths | text[] | |
| estimated_roi | text | |
| time_to_complete | text | |
| computed_at | timestamptz DEFAULT now() | |

**Unique:** (opportunity_id, org_id)

### 51. agent_registry
Master catalog of all available agents.

| Column | Type | Notes |
|---|---|---|
| agent_id | text PK | ag-01 through ag-30 |
| name | text NOT NULL | |
| description | text NOT NULL | |
| version | text DEFAULT '1.0' | |
| plan_requirement | text NOT NULL | starter/professional/enterprise |
| trigger_type | text NOT NULL | manual/scheduled/event |
| schedule_cron | text | Cron expression if scheduled |
| avg_runtime_seconds | integer | |
| active | boolean DEFAULT true | |
| created_at | timestamptz DEFAULT now() | |

### 52. agent_configurations
Per-org agent enable/disable and config.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| agent_id | text NOT NULL | FK → agent_registry(agent_id) |
| enabled | boolean DEFAULT false | |
| config | jsonb DEFAULT '{}' | Agent-specific parameters |
| last_run_at | timestamptz | |
| run_count | integer DEFAULT 0 | |
| total_tokens_consumed | integer DEFAULT 0 | |
| created_at | timestamptz DEFAULT now() | |

**Unique:** (org_id, agent_id)

### 53. discovery_runs
Opportunity discovery run logs.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| run_date | date NOT NULL | |
| opportunities_found | integer DEFAULT 0 | |
| opportunities_matched | integer DEFAULT 0 | |
| sources_checked | text[] | |
| runtime_seconds | integer | |
| created_at | timestamptz DEFAULT now() | |

### 54. discovery_matches
Per-org discovered opportunity matches.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| opportunity_id | uuid | FK → opportunities(id) if imported |
| external_title | text | If not yet imported |
| external_source | text | |
| external_url | text | |
| discovery_run_id | uuid | FK → discovery_runs(id) |
| match_score | numeric | 0-1 |
| match_reasons | text[] | |
| status | text DEFAULT 'pending' | pending/added/dismissed |
| actioned_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_discovery_matches_org ON (org_id, status)

### 55. reputation_signals
Reputation events for any entity.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| entity_id | uuid NOT NULL | FK to any entity |
| entity_type | text NOT NULL | funder/corporate/foundation |
| signal_type | text NOT NULL | legal/leadership/financial/press/positive |
| severity | text NOT NULL DEFAULT 'yellow' | critical/high/medium/low/positive |
| headline | text NOT NULL | Max 100 chars |
| summary | text | Max 200 chars |
| source_url | text | |
| signal_date | date | |
| verified | boolean DEFAULT false | |
| created_at | timestamptz DEFAULT now() | |

### 56. reputation_alerts
Per-org reputation alert feed.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| signal_id | uuid | FK → reputation_signals(id) |
| status | text DEFAULT 'unread' | unread/read/dismissed |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_reputation_alerts_org ON (org_id, status)

### 57. relationship_memory
Funder relationship event memory.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| entity_id | uuid NOT NULL | |
| entity_type | text NOT NULL DEFAULT 'funder' | |
| memory_type | text NOT NULL | email/call/press/linkedin/990/meeting |
| content | text NOT NULL | |
| signal_date | date | |
| actioned | boolean DEFAULT false | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_rel_memory_org ON (org_id, entity_id)

### 58. relationship_recommendations
AI-generated engagement recommendations.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| entity_id | uuid NOT NULL | |
| entity_type | text NOT NULL DEFAULT 'funder' | |
| recommendation_text | text NOT NULL | |
| urgency | text DEFAULT 'normal' | urgent/normal/low |
| status | text DEFAULT 'pending' | pending/actioned/dismissed |
| created_at | timestamptz DEFAULT now() | |

### 59. pig_nodes
Philanthropic Intelligence Graph — entity nodes.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| node_type | text NOT NULL | business/foundation/government/person/nonprofit |
| entity_id | uuid NOT NULL | FK to source table |
| entity_table | text NOT NULL | Which table entity_id references |
| label | text NOT NULL | Display name |
| metadata | jsonb DEFAULT '{}' | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Unique:** (entity_table, entity_id)
**Indexes:** idx_pig_nodes_entity ON (entity_table, entity_id)

### 60. pig_edges
Philanthropic Intelligence Graph — relationship edges.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| source_node_id | uuid | FK → pig_nodes(id) ON DELETE CASCADE |
| target_node_id | uuid | FK → pig_nodes(id) ON DELETE CASCADE |
| relationship_type | text NOT NULL | previously_donated_to/serves_on_board/shares_executives/etc |
| weight | numeric DEFAULT 1.0 | Relationship strength |
| evidence | text | |
| verified | boolean DEFAULT false | |
| metadata | jsonb DEFAULT '{}' | |
| discovered_at | timestamptz DEFAULT now() | |

**Unique:** (source_node_id, target_node_id, relationship_type)
**Indexes:** idx_pig_edges_source, idx_pig_edges_target, idx_pig_edges_type

### 61. disaster_declarations
FEMA disaster declaration tracking.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| fema_disaster_number | text UNIQUE | |
| disaster_type | text | |
| incident_type | text | |
| affected_states | text[] | |
| declaration_date | date | |
| incident_begin_date | date | |
| response_deployed | boolean DEFAULT false | |
| response_deployed_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_disaster_decl_states USING GIN ON (affected_states)

### 62. disaster_emergency_funds
Standing database of emergency funding sources.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| funder | text NOT NULL | |
| program_type | text | |
| typical_amount | text | |
| application_url | text | |
| notes | text | |
| disaster_types | text[] | Which disaster types this applies to |
| active | boolean DEFAULT true | |

### 63. funding_forecasts
90-day and 12-month funding projections.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| forecast_date | date NOT NULL | |
| forecast_period | text NOT NULL | 90_day/12_month |
| projected_min | numeric | |
| projected_max | numeric | |
| projected_most_likely | numeric | |
| confidence | numeric | 0-1 |
| methodology | text | |
| factors | jsonb DEFAULT '{}' | |
| key_risks | text[] | |
| key_opportunities | text[] | |
| recommended_actions | text[] | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_forecasts_org ON (org_id, forecast_date)

### 64. board_members
Org board member records.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| name | text NOT NULL | |
| email | text | |
| role | text | Chair/Vice Chair/Treasurer/Secretary/Member |
| committee | text[] | |
| term_start | date | |
| term_end | date | |
| expertise | text[] | |
| active | boolean DEFAULT true | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_board_members_org ON (org_id)

### 65. board_meetings
Scheduled board meetings.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| meeting_date | date NOT NULL | |
| meeting_type | text DEFAULT 'regular' | regular/special/annual |
| agenda | text | |
| status | text DEFAULT 'scheduled' | scheduled/completed/cancelled |
| created_at | timestamptz DEFAULT now() | |

### 66. board_meeting_packets
AI-generated board meeting packets.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| meeting_id | uuid | FK → board_meetings(id) |
| packet_content | jsonb NOT NULL | Full structured packet |
| generated_at | timestamptz DEFAULT now() | |
| viewed_by | text[] | Email addresses of viewers |

### 67. impact_simulations
What-if scenario modeling results.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| scenario_type | text NOT NULL | receive_grant/lose_grant/new_location/hire_staff/serve_more |
| scenario_params | jsonb NOT NULL | Input parameters |
| simulation_result | jsonb | Full structured result |
| confidence | text | high/medium/low |
| generated_at | timestamptz DEFAULT now() | |
| created_by | uuid | FK → profiles(id) |

**Indexes:** idx_simulations_org ON (org_id)

---

## Migration Index

| Migration | Description | Status |
|---|---|---|
| 001-030 | Core tenant tables (organizations through platform_config) | APPLIED |
| 031-040 | Foundation directory and intelligence corpus | APPLIED |
| 041-055 | AutoApply, submission queue, form analyses | APPLIED |
| 056-075 | Donor Discovery (taxonomy, directory, requests, aliases) | APPLIED |
| 076-084 | Corporate Intelligence Engine | APPLIED |
| 085 | Foundation profiles | APPLIED |
| 086 | Financial reconciliation (budgets, expenses, reports) | APPLIED |
| 087 | Compliance calendar | APPLIED |
| 088 | Funder relationship scoring | APPLIED |
| 089 | White-label consultant portal | APPLIED |
| 090 | Notification preferences | APPLIED |
| 091 | Digital Twin + Probability Scores | QUEUED (tonight) |
| 092 | Agent Marketplace + Discovery | QUEUED (tonight) |
| 093 | Reputation Intelligence + Relationship Builder | QUEUED (tonight) |
| 094 | Philanthropic Intelligence Graph | QUEUED (tonight) |
| 095 | Forecast + Board Advisor | QUEUED (tonight) |
| 096 | Disaster Response Engine | QUEUED (tonight) |
| 097 | Knowledge Engine (pgvector, patterns, queries) | QUEUED (tonight) |

---

## Data Volume Estimates

| Table | Current Records | Target Scale |
|---|---|---|
| foundation_directory | 133,812 | 200K+ |
| nonprofits (BMF import) | 0 | 1.8M |
| corporate_prospects | 0 | 10M+ |
| intelligence_funded_proposals | 11 | 2,000+ |
| donor_discovery_directory | Unknown | 500K+ per org |
| pig_nodes | 0 | 10M+ |
| pig_edges | 0 | 50M+ |
