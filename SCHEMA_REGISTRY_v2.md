# BENAVORA — Schema Registry v2.0
## Supersedes: SCHEMA_REGISTRY.md v1.0
## Date: July 17, 2026
## Status: CANONICAL — All migrations listed here are the authoritative source of truth.
## Current migration count: 097 applied or queued

> **Coverage note (2026-09-19, AR-13.3):** `foundation_directory`'s
> `programs` column (text[]) is `NULL` on all 133,812 live rows, and no
> writer anywhere in this codebase (`enrich-foundations-990.ts`,
> `enrich-foundations-propublica.ts`, `enrich-foundations-web.ts`,
> `enrich-foundations-websites.ts`, `foundation-scraper.ts`) has ever
> populated it or an `enrichment.mission` jsonb key — confirmed by live
> query and by grepping every writer's full history. `ag-29-knowledge-indexer`
> (`src/lib/agents/knowledge-indexer-agent.ts`) reads exactly those two
> fields to decide what to embed, so this column has been structurally
> dead weight since it was added — not a recent regression. See
> `test-evidence/DATA_PIPELINE_AUDIT.md` §1 for full detail. No schema
> change was made this session (diagnose only); a future fix should either
> populate `programs`/`enrichment.mission` from the 990/ProPublica data
> these scripts already parse, or repoint `flattenFoundationText()` at the
> `enrichment.propublica.*` fields that are genuinely populated today.
>
> **Follow-up (2026-09-19, AR-14.1): fixed.** `flattenFoundationText()` now
> falls back to `enrichment.propublica.*` (the field 133,811/133,812 rows
> actually carry) whenever `programs`/`enrichment.mission` are both absent.
> `programs`/`enrichment.mission` themselves are still never written by any
> producer — this remains a real, open gap for a future session that wants
> `flattenFoundationText()`'s two primary sources to actually populate — but
> `foundation_directory` is no longer permanently unindexable in the
> meantime. No schema/column change; application-layer fix only. See
> `STATE_OF_THE_BUILD.md`'s "AR-14.1" section for live before/after numbers.

> **Coverage note (2026-09-17, AR-3.1):** This doc's "097 applied or queued" snapshot predates
> `autoapply_submissions` and `form_templates` (both from migration 045) — neither table is indexed
> anywhere below; see `supabase/migrations/045_autoapply_tables.sql` directly. Migration 184 added
> a new value, `'submit_unverified'`, to `autoapply_submissions.status`'s CHECK constraint — see
> `AUTOAPPLY_ARCHITECTURE_V2.md`'s "Submit-integrity note (AR-3.1)" for what it means and
> `STATE_OF_THE_BUILD.md`'s "AR-3.1" section for the full incident. Migration 184 was applied live
> via the Supabase MCP `apply_migration` tool on 2026-09-17 (direct `psql` again timed out from the
> sandbox) — confirmed by re-querying `autoapply_submissions_status_check`'s definition before and
> after; `'submit_unverified'` is real in production.

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
CREATE TYPE agent_run_status AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped'); -- 'skipped' added by migration 199 (AR-11.1), used by run-logger.ts and, since AR-14.1, ag-29-knowledge-indexer for zero-item passes
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
| knowledge_patterns_applied | jsonb NOT NULL DEFAULT '[]' | Knowledge Engine (migration 096) `knowledge_patterns.id` values injected into this draft's prompt — added by `src/supabase/migrations/123_knowledge_engine_draft_integration.sql`, backfilled into this canonical directory by `supabase/migrations/183_applications_knowledge_patterns_applied.sql` (AR-2.2, 2026-09-17). Live-verified present in production 2026-09-17. |

**Indexes:** idx_applications_org, idx_applications_stage, idx_applications_funder

**Note (AR-2.2, 2026-09-17):** this section is known stale beyond the row above — live `applications` also
carries `auto_generated`, `pending_review`, `draft_source`, `platform_patterns_applied`, `twin_powered`,
`twin_completeness`, `compliance_check_result`, and `metadata` (see
`src/lib/agents/draft-generation-agent.ts`'s `DraftApplicationPayload`), none of which are documented here.
Out of scope for this session; flagged rather than silently left implying the table has only the columns
listed above.

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

**LIVE (confirmed 2026-09-17, AR-2.2):** created by `supabase/migrations/107_corporate_prospects.sql`
(+ agent_type enum values in `108`/`109`), RLS-hardened by `111_corporate_prospects_rls_hardening.sql`,
and given `authenticated` SELECT/UPDATE(scores, scores_computed_at) grants + policies by
`179_corporate_prospects_authenticated_grant.sql`. Live column list, constraints, RLS state, and grants
all verified via direct Postgres query this session — exact match to the table below, including the
(legal_name, address_city, address_state) unique constraint. An earlier session (2026-07-30) recorded
this table as absent from production; that was true at the time but is no longer current — see
project memory `benavora-ag22-propensity-batch-route-built-2026-09-10`.

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

**Note (2026-09-17):** this index was not maintained past migration 097. The live schema is far
ahead of it (highest applied migration is 186 as of this note, including the 12-table Prospect
Intelligence Layer batch at 150-169 and everything through AR-5.1 below) — treat everything above
this note as historical, not current, for any migration number beyond 097.

---

## `ai_usage_log` writers, corrected (AR-9.2, 2026-09-18)

**Correction to the "Cost Ledger Consolidation (AR-5.1)" section immediately below:** that section
describes `recordCost()` as "the single writer" of `ai_usage_log` — true of the code, false of what
actually ran. `recordCost()`'s only two call sites are inside `src/lib/pil/agent-runner.ts` (the PIL
agent framework), and the platform's real dominant traffic — `ag-29-knowledge-indexer` and ~90 other
`BaseAgent`/`AutonomousAgent` subclasses under `src/lib/agents/**`, which call Anthropic through the
separate shared wrapper `src/lib/ai/claude.ts` — never called `recordCost()` at all. Live-verified:
184 real `agent_runs` in a 3-hour window produced 0 new `ai_usage_log` rows; all 49 rows, all time,
predate this session (migration-186 backfill, last written 2026-09-16).

`src/lib/ai/claude.ts`'s four `callClaude*` functions (`callClaude`/`callClaudeConversation`/
`callClaudeWithTools`/`callClaudeWithWebSearch`) now call `recordCost()` too, after every successful
`messages.create()`, using the real model name and real `usage.input_tokens`/`output_tokens` — so
`ai_usage_log` now has two independent writer paths into the same table: PIL's (`agent_run_id` NULL,
`pil_agent_run_id` set) and core's (`agent_run_id` set, `pil_agent_run_id` NULL), exactly matching the
dual-FK shape migration 185 already provided for this. Org/agent/run attribution for the core path
comes from a new `AsyncLocalStorage` context (`src/lib/ai/usage-context.ts`), set once at
`BaseAgent.run()`/`AutonomousAgent.startRun()` — `callClaude*`'s call sites did not need new
parameters.

`cost_usd` is now nullable in the TS type (`CostLedgerEntry.cost_usd: number | null`, matching the DB
column, which was already nullable) — `src/lib/ai/pricing.ts` (new, reads `model_cost_reference`,
cached 5 min) returns `null` rather than `0` for a model with no rate row, so an unpriced call reads
as "unpriced," not "free," and correctly skips AR-5.2's `accrue_cost_budget_spend` trigger (`WHERE
NEW.cost_usd IS NOT NULL`).

**Third writer path, added in the AR-9.2 recovery pass (same day):** the ~34 raw
`new Anthropic(...)` sites under `src/lib/autoapply/**`, `src/lib/intelligence/**`,
`src/lib/donor-discovery/**`, `src/lib/scraper-v2/**`, `src/lib/enrichment/**`,
`src/lib/email/thread-linker.ts`, `src/lib/admin/unsubscribe-agent.ts`,
`src/lib/sources/land-bank-client.ts` and several `src/scripts/*` — which bypassed `claude.ts` and
recorded nothing — now construct their client via `createTrackedAnthropic()`
(`src/lib/ai/tracked-anthropic.ts`), which wraps `messages.create` to record once per successful
call. Rows from this path carry `endpoint` = the calling module's slug (e.g. `pattern-engine`,
`submission-validator`) rather than a `callClaude*` function name, which is how you tell the three
writer paths apart in the table. The recorder shared by all paths now lives in
`src/lib/ai/usage-recorder.ts` (moved out of `claude.ts`) so there is one implementation, not two
that can drift.

**`billing_path` semantics (column added by migration 185, now actually varied):** `'api'` = a
runtime call on `ANTHROPIC_API_KEY`, priced from `model_cost_reference` into `cost_usd`.
`'subscription'` = a FORGE/Max-plan build run: real token counts recorded, `cost_usd` deliberately
`NULL`, because those tokens carry no per-token dollar cost and pricing them would overstate platform
spend. Reading `SUM(cost_usd)` therefore gives API spend; `COUNT(*) WHERE cost_usd IS NULL`
distinguishes "not applicable / unpriced" from "free."

**Capture is bounded by attribution, not instrumentation.** `organization_id` is `NOT NULL`, so a row
is written only when a `UsageContext` is active (set at `BaseAgent.run()` /
`AutonomousAgent.startRun()`). An Anthropic call made outside any agent run boundary — several
autoapply helpers invoked directly by `worker/queue-processor.ts`, and the operator `src/scripts/*`
ingests — writes no row and instead raises a throttled `system_errors` row
(`source='ai_usage_log'`, `error_type='usage_log_no_context'`). Live-verified post-fix 2026-09-18
07:56 UTC: `count(*) = 52` (was 49), `sum(cost_usd) = 0.377406`, `count(*) WHERE cost_usd IS NULL = 0`.
Repeatable proof: `pnpm verify:ai-usage`. Full detail: `STATE_OF_THE_BUILD.md`'s AR-9.2 entry.

## Cost Ledger Consolidation (AR-5.1, 2026-09-17)

`ai_usage_log` (original shape: migration 056, `agent_type` column, `estimated_cost_cents integer`)
is now the platform's single per-call cost ledger. Migrations 185-186 verified live facts before
changing anything: `ai_usage_log` had 0 rows and no application reader/writer; `pil_cost_ledger`
(migration 158, documented nowhere in this file since it postdates migration 097 — see the note
above) had 49 rows and was the only table `recordCost()` wrote to.

Migration 185 added, all nullable/defaulted so the change is additive:
| Column | Type | Notes |
|---|---|---|
| cost_usd | numeric(14,6) | Real per-call USD cost. `estimated_cost_cents` (integer) is left in place but unwritten — it rounds any sub-cent call (e.g. a $0.0035 Haiku call) to 0. |
| agent_run_id | uuid, FK → agent_runs(id) ON DELETE SET NULL | Core (non-PIL) agent run attribution. |
| pil_agent_run_id | uuid, FK → pil_agent_runs(id) ON DELETE SET NULL | PIL agent run attribution — this is what pil_cost_ledger.agent_run_id actually pointed to. |
| provider | text NOT NULL DEFAULT 'anthropic' | Which LLM/API provider was billed. |
| billing_path | text NOT NULL DEFAULT 'api', CHECK IN ('api','subscription') | 'api' = real Anthropic Console spend (Benavora runtime agents, ANTHROPIC_API_KEY). 'subscription' = FORGE `claude` CLI build runs against a Max subscription (forge-orchestrator.ps1 forces ANTHROPIC_API_KEY=$null) — no per-token dollar cost. Without this column subscription rows would read as real spend. |

Migration 186 backfilled all 49 `pil_cost_ledger` rows into `ai_usage_log` (verified post-migration:
`count=49`, `sum(cost_usd)=0.3771`, all `billing_path='api'`), then marked `pil_cost_ledger`
superseded and read-only via `COMMENT ON TABLE` — it was **not** dropped; it remains the sole audit
trail for those 49 rows, and `src/lib/pil/db.ts`'s `pilCostLedger()` (a dead export, zero callers)
still reads it. Nothing in `src/` or `worker/` inserts into `pil_cost_ledger` anymore;
`src/lib/pil/cost.ts`'s `recordCost()` inserts into `ai_usage_log`.

**Former second per-call cost writer, closed by AR-10.2:** `adapter_usage_log` (migration 076) was
written by `src/lib/donor-discovery/adapters/google-places-adapter.ts` and
`src/lib/donor-discovery/connectors/usage-log.ts`, with `api_cost_cents` a real number for Google
Places and a hardcoded `0` for Apollo/Hunter regardless of call outcome. AR-5.1 consolidated only the
pair the task named (`ai_usage_log` / `pil_cost_ledger`); this table was untouched until AR-10.2
(2026-09-18, see below) retired `api_cost_cents` as a cost writer entirely — `ai_usage_log` is now the
only table in this codebase written with per-call cost.

---

## Budget Enforcement: `cost_budgets` rename, `orchestration` scope, spend accrual (AR-5.2, 2026-09-17)

`pil_cost_budgets` (migration 158, 9.2) is renamed to `cost_budgets` by migration 187 (0 rows live at
rename time, so no data movement). Shape is unchanged except the `scope_type` CHECK: `id`,
`organization_id` (FK → `organizations(id)` ON DELETE CASCADE), `scope_type`, `scope_id`,
`budget_period`, `budget_limit_usd`, `spent_usd` (DEFAULT 0), `alert_threshold_pct`, `hard_stop`
(DEFAULT true), `created_at`, `updated_at`, `UNIQUE (organization_id, scope_type, scope_id,
budget_period)`. RLS policies (`..._org_select/_insert/_update`) and the `idx_pil_cost_budgets_org`
index kept their pre-rename names — Postgres does not rename dependent objects when a table itself is
renamed, and nothing requires them to match the new table name to function correctly.

`scope_type` CHECK extended from `'org' | 'agent' | 'research_run'` to add `'orchestration'` — a plain
`text` CHECK constraint, not a Postgres enum, so this was a normal `DROP CONSTRAINT` / `ADD CONSTRAINT`
pair (the live constraint name was looked up via `pg_constraint` rather than assumed, since it kept its
pre-rename auto-generated name `pil_cost_budgets_scope_type_check` after the table rename).

**Spend now genuinely accrues.** Before this migration, `spent_usd` was read by `checkBudget()`
(`src/lib/pil/cost.ts`), `BEN-SUP-03.ts:296`, and `BEN-SUP-04.ts:256`, and written by nothing — a
`hard_stop` budget could never actually stop anything. Migration 187 adds
`accrue_cost_budget_spend()`, a `SECURITY DEFINER` (fixed `search_path = public`) trigger function,
fired by `ai_usage_log_accrue_cost_budget` — `AFTER INSERT ON ai_usage_log` — that runs:

```sql
UPDATE cost_budgets
SET spent_usd = spent_usd + NEW.cost_usd, updated_at = now()
WHERE organization_id = NEW.organization_id
  AND scope_type = 'org'
  AND scope_id = NEW.organization_id::text;
```

No-ops (does not error) when no matching `'org'`-scope budget row exists — matches `checkBudget()`'s
pre-existing "no budget configured, nothing to enforce" behavior. Pure SQL, no `pg_net` call (not
installed on this project). **Only the `'org'` scope auto-accrues.** `'agent'`, `'research_run'`, and
the new `'orchestration'` scope can hold budget rows and be read via `checkBudget(orgId, scopeType,
scopeId)`, but nothing currently writes their `spent_usd` — a future task wiring per-agent or
per-orchestration-run spend tracking would need its own accrual path (or an extended version of this
trigger); do not assume those scopes enforce anything today just because the column exists.

`checkBudget()` signature: `checkBudget(orgId: string, scopeType: CostBudgetScopeType = "org", scopeId:
string = orgId)` — generalized from a hardcoded org-scope-only check. `CostBudgetScopeType`
(`src/lib/pil/types.ts`) is now `"org" | "agent" | "research_run" | "orchestration"`.

Live-verified via `src/__tests__/integration/budget-accrual.test.ts` (4/4, real DB, no mocks) and FORGE
gate `scripts/audit/forge-gates/ar-5-budget-accrual.mjs` (`OK: one budget table (cost_budgets) with an
orchestration scope, spend accrues by SQL trigger on ai_usage_log, no stale references`). Full defect
history and the "what hard_stop can/cannot stop" boundary in `STATE_OF_THE_BUILD.md`'s and
`SESSION_STATE.md`'s "AR-5.2" sections.

---

## Orchestration Alert Types: `alerts` extended, no second table (AR-6.1, 2026-09-17)

The Orchestration Logging and Alerting Specification v1.0 proposed a new `orchestration_alerts`
table with acknowledge/dismiss/severity/dedup. `public.alerts` (migration 013, **not** documented
accurately in this file's "14. alerts" entry above — that entry is stale v1.0 content describing a
`title`/`entity_type`/`entity_id` shape that was never applied; the real live shape is below)
already had every one of those and was live in production with 1,806 rows (most recent `'system'`
alert written the morning of 2026-09-17). A second table would mean two inboxes and strand that
history behind the wrong one, so this extends `alerts` instead of creating one.

**Live `public.alerts` shape (migration 013, corrects the stale "14. alerts" entry above):** `id`,
`organization_id` (FK → `organizations(id)`), `type` (`alert_type` enum), `severity`
(`alert_severity` enum, DEFAULT `'info'`), `message`, `link`, `is_read`/`read_at` (acknowledge),
`is_dismissed`/`dismissed_at` (dismiss), `snoozed_until` (snooze), `opportunity_id`/`application_id`/
`deadline_id` (provenance FKs), `dedup_key`, `created_by`, `created_at`, `updated_at`. Indexes:
`uq_alerts_org_dedup` (UNIQUE on `organization_id, dedup_key` — the noise-suppression mechanism),
`idx_alerts_org`, `idx_alerts_type`, `idx_alerts_active`.

Migration 188 adds eight `alert_type` enum values: `task_failed`, `cost_overage`,
`schema_mismatch`, `state_drift`, `rate_limit`, `timeout`, `rollback`, `manual_review_required`.
Shipped as its own migration file containing only `ALTER TYPE ... ADD VALUE IF NOT EXISTS`
statements — Postgres forbids referencing a new enum value in the same transaction that added it
("unsafe use of new value of enum type"), so nothing that uses these values can ship in the same
file.

Migration 189 adds two nullable columns to `public.alerts`: `orchestration_id` (`uuid`, no FK — no
single orchestration registry table exists yet across PIL/AutoApply/agent-runner) and `notified_at`
(`timestamptz`, delivery idempotency marker for prompt 6.4's outbound notification dispatch, added
now per the Phase 6.1 spec). `idx_alerts_orchestration_id` indexes the new FK-shaped column.

**Deterministic dedup keys.** `dedupKeys` in `src/lib/alerts/alerts-service.ts` gained eight
orchestration builders (e.g. `orchestrationTaskFailed(orchestrationId, agentType)` →
`` `orchestration:task_failed:${orchestrationId}:${agentType}` ``), all with **no random
component** — two calls describing the same event must produce the same key or
`uq_alerts_org_dedup` never fires. **Known pre-existing bug, not touched by this migration:**
`src/lib/agents/base-agent.ts:232`, `src/lib/agents/autonomous-base.ts:292`, and
`src/lib/agents/deadline-prediction-agent.ts:560` append `crypto.randomUUID()` to their dedup
keys, which defeats the unique index for those agents entirely — every alert they write is
unique, so none of them ever dedup. Logged here as follow-up work; AR-6.1 only added new key
builders and did not touch those three call sites.

Live-application status: migration 188/189 files are committed, but this session's two live-DDL
paths (`DATABASE_URL` via `psql` — password auth failure; Management API PAT from this file's
own §11 — `401 Unauthorized`, rotated since it was last live-verified) both failed, so the ADD
VALUE/ADD COLUMN statements are **not confirmed applied to project `vbjplpquqxxfbpazyalt`** as of
this note. `pnpm typecheck`/`build`/`test` all pass against the hand-maintained
`src/types/database.ts`, which does not require a live DB match to compile.

---

## `orchestration_logs`: execution facts for one step of one orchestration run (AR-6.2, 2026-09-17)

`public.orchestration_logs`: `id`, `organization_id` (`NOT NULL REFERENCES organizations(id) ON
DELETE CASCADE`), `orchestration_id` (`uuid NOT NULL`, no FK — groups every row one orchestrator
call wrote; correction to AR-6.1's `alerts.orchestration_id` note above, which said "no single
orchestration registry table exists yet" — this is now that table, though `alerts.orchestration_id`
was not retroactively given an FK to it, since an alert can legitimately reference an orchestration
that never logged a step), `task_id`, `agent_type`, `agent_run_id` (FK `agent_runs`),
`pil_agent_run_id` (FK `pil_agent_runs`), `status`, `started_at`/`finished_at`/`duration_ms`,
`items_expected`/`items_processed`, `error_code`/`error_message`, `schema_validation_passed`/
`reconciliation_passed` (booleans — not derived from `status`, the two columns this table exists
for), `state_delta` (jsonb), `cost_log_id` (FK `ai_usage_log`, no `cost_usd` — cost stays the
AR-5.1 single ledger), `created_at`. Indexes: `(organization_id, created_at DESC)`,
`(orchestration_id)`, `(status) WHERE status <> 'completed'`, `(agent_run_id)`.

**RLS:** matches the live `public.current_org_id()` master pattern from migration 001 (e.g.
`agent_runs_org_isolation`), not the `src/supabase/migrations`-only lockdown convention (zero-policy
+ revoke-all is for orphaned tables with no real authenticated reader — this table is meant to be
read by org members: recovery tooling, dashboards). `REVOKE ALL FROM anon`; one policy,
`orchestration_logs_org_isolation`, `FOR SELECT USING (organization_id = current_org_id())`. No
`authenticated` write policy — the worker's service-role client does all writing and bypasses RLS
regardless, so there is no authenticated write path to close.

**Writer:** `src/lib/orchestration/orchestration-log.ts` is the only code that inserts into this
table — `logOrchestrationStep()` (redacts `error_message`/`state_delta` before insert: `sk-ant-*`,
generic `sk-*`/`pk-*`, AWS `AKIA*`, JWT-shaped tokens, `Bearer <token>`, `key/token/secret/password
= value` pairs, plus full-value redaction by key name) and `runOrchestrationStep()` (times one call,
writes one row, rethrows unchanged). Wired into `worker/autonomous-orchestrator.ts` at 25 boundary
functions (16 nightly per-org steps + the single `runQueueItem()` choke point covering all 27
`routeQueueItem()` cases + `runDigestPipeline()` + 7 of 8 standalone pipelines) — see
`STATE_OF_THE_BUILD.md`'s "AR-6.2" section for the full list and the one named gap
(`runSelfImprovementPipeline`/AG-38's dedicated cron entrypoint, which has no owning org by design).

Live-verified via `src/__tests__/integration/orchestration-logs.test.ts` (4/4, real DB including
the RLS assertion) and applied live to project `vbjplpquqxxfbpazyalt` via the Supabase MCP
connector — confirmed via `pg_policies`.

---

## Deterministic alert rules 1-5 in Postgres (AR-6.3, 2026-09-17)

**Prerequisite gap found live, not assumed from the commit:** migrations 188/189 (AR-6.1) were
committed but not actually applied — a REST probe against `alerts` before this migration returned
`22P02 invalid input value for enum alert_type` for `task_failed` and `42703 column
alerts.orchestration_id does not exist`. Applied 188, then 189, then this migration (191) in order
via the Supabase MCP connector after both previously-known DDL paths failed again; all three
confirmed live afterward via direct `pg_enum`/column queries.

**`raise_orchestration_alert(org_id, orchestration_id, type, severity, message, dedup_key)`** — the
one shared write path every rule below (and the application-layer helper for the three
non-trigger-derivable types) uses: `INSERT ... ON CONFLICT (organization_id, dedup_key) DO NOTHING`,
its own `EXCEPTION WHEN OTHERS` swallow. `SECURITY DEFINER`, `search_path = public` fixed. **EXECUTE
revoked from `PUBLIC`, `anon`, and `authenticated` explicitly** — Supabase grants new functions'
`EXECUTE` to `anon`/`authenticated` individually by default (confirmed via `pg_proc.proacl`), which
made this SECURITY DEFINER, no-caller-check function briefly callable as
`rpc/raise_orchestration_alert` with an arbitrary `organization_id` (live-verified: returned HTTP 204
before the fix, `401`/`42501 permission denied` after). Granted only to `service_role`.

**Five `AFTER INSERT OR UPDATE` triggers**, all wrapped in `EXCEPTION WHEN OTHERS` (never block the
INSERT/UPDATE that fired them — live-proven via a deliberately malformed `state_delta.retry_count`
that throws inside Rule 1's `::int` cast; the underlying `orchestration_logs` row still writes):

| Rule | Table / event | Fires when | Severity |
|---|---|---|---|
| `task_failed` | `orchestration_logs`, INSERT/UPDATE | `status = 'failed'` | critical if last retry (from `state_delta.retry_count`/`max_retries`, no column of its own on this table), else warning |
| `cost_overage` | `cost_budgets`, INSERT/UPDATE OF `spent_usd`, `budget_limit_usd` | `spent_usd >= budget_limit_usd` (fed by AR-5.2's `accrue_cost_budget_spend`) | critical if `hard_stop`, else warning |
| `schema_mismatch` | `orchestration_logs`, INSERT/UPDATE OF `schema_validation_passed` | `schema_validation_passed = false` | critical |
| `state_drift` | `orchestration_logs`, INSERT/UPDATE | see deviation below | critical |
| `timeout` | `orchestration_logs`, INSERT/UPDATE | `duration_ms > 60000`, or `finished_at IS NULL` and `started_at` already >60s old | warning |

Dedup keys are built from stable row identifiers (`orchestration_id`, `agent_type`/`task_id`,
`scope_type`/`scope_id`) — never `crypto.randomUUID()` — so `uq_alerts_org_dedup` (migration 013)
actually collapses repeats. `cost_overage`'s key, `(scope_type, scope_id)`, deliberately diverges from
`src/lib/alerts/alerts-service.ts`'s `dedupKeys.orchestrationCostOverage(orchestrationId)`, since a
`cost_budgets` row is routinely `scope_type='org'`/`'agent'` with no orchestration context at all.
**Known latent gap, not yet fixable/testable:** this key has no budget-period component, so if
`spent_usd` is ever reset for a new period (no reset mechanism exists in this codebase yet), a
genuine new-period overage would collide with the old period's dedup key and be dropped.

**`state_drift` deviates from spec section 8 by design** (diffing `STATE_OF_THE_BUILD.md` before/
after each task would flag every legitimate governance update as "drift"). Reconciles against the DB
instead, only for a `status='completed'` row: (1) `agent_run_id`/`pil_agent_run_id`, if set, must
point at a row with a terminal status; (2) `items_processed` must be coherent with `items_expected`
— **not** a plain inequality (a live read of `worker/autonomous-orchestrator.ts` shows
`items_processed < items_expected` is the normal healthy shape, "candidates found" vs. "candidates
acted on" — a blanket mismatch check was drafted, then rejected before ever being applied live for
the same reason spec section 8 was rejected). Only `items_processed IS NULL` (claimed success, zero
evidence) or `items_processed > items_expected` (impossible over-count) count as incoherent. An
explicit `reconciliation_passed=false` from a caller with real target-table knowledge (AR-6.2's
`toOutcome()`) is honored as an additional, independent signal.

`rate_limit`/`rollback`/`manual_review_required` are not trigger-derivable (nothing in Postgres knows
an upstream 429, a rollback ran, or an agent refused an action) — raised instead from
`src/lib/alerts/raise-orchestration-alert.ts`, same dedup contract, every failure swallowed. Wired
into `worker/queue-processor.ts`'s `IncompleteSubmissionError` catch (AutoApply refusing to submit
with required fields still empty) → `manual_review_required`.

**No network from SQL:** no `pg_net`/`http`/`pg_cron` install, no `net.http_post`, anywhere in
migration 191 — verified against the live project (all three available but not installed) before
writing a line of trigger code.

**Test:** `src/__tests__/integration/orchestration-alert-rules.test.ts`, 8/8 green against the real
database. Full rationale, both miscalibrations caught before/after the live apply, and the flagged
latent Rule 2 dedup gap: `STATE_OF_THE_BUILD.md`'s "AR-6.3" section.

---

## Worker-side Slack delivery, verified rate card, RLS-safe dashboard views (AR-6.4, 2026-09-17)

**`public.model_cost_reference`** (migration 192) — `model text PRIMARY KEY`,
`input_usd_per_mtok`/`output_usd_per_mtok`/`cache_write_usd_per_mtok`/`cache_read_usd_per_mtok
numeric(10,4)`, `effective_from date`, `source text`. Global reference table, no `organization_id` —
rates apply identically to every org. RLS enabled, `anon` revoked, `authenticated` granted `SELECT`
via a `USING (true)` policy (read-only reference data, not tenant data). Seeded with 5 rows, each
`source = 'https://claude.com/pricing'` and `effective_from = '2026-09-17'` — verified by a live
WebFetch against that URL during this session, not recalled from training data or copied from the
spec (whose Sept-2025 card, `claude-opus-4`/`claude-sonnet-4`, has zero references anywhere in
`src/`/`worker/` and was rejected outright):

| model | input | output | cache write (5m) | cache read |
|---|---|---|---|---|
| `claude-sonnet-4-6` | $3.00 | $15.00 | $3.75 | $0.30 |
| `claude-haiku-4-5` | $1.00 | $5.00 | $1.25 | $0.10 |
| `claude-haiku-4-5-20251001` | $1.00 | $5.00 | $1.25 | $0.10 |
| `claude-sonnet-5` | $2.00 | $10.00 | $2.50 | $0.20 |
| `claude-opus-5` | $5.00 | $25.00 | $6.25 | $0.50 |

`cache_write_usd_per_mtok` carries the 5-minute-TTL rate (1.25x input); the 1-hour-TTL rate (2x input)
is documented in a `COMMENT ON COLUMN` rather than a second column, matching the pricing page's own
per-TTL split. `cache_read_usd_per_mtok` is 0.1x input for both TTLs.
`src/__tests__/integration/alert-delivery.test.ts`'s "Rate card freshness" suite fails the build if any
seeded row's `effective_from` is more than 180 days old, so this table cannot silently rot past that
window the way the spec's own year-old card did.

**Prerequisite fix: `ai_usage_log` had RLS enabled with zero policies and zero `authenticated`
grants** (migration 056 never added either) — default-deny, so no org member could read their own
cost rows, directly or through a view. Fixed in migration 193 with the same pattern
`orchestration_logs_org_isolation` (AR-6.2) already uses: `GRANT SELECT ... TO authenticated`, `REVOKE
ALL ... FROM anon`, one `FOR SELECT USING (organization_id = current_org_id())` policy. No
authenticated write path added — service role still does all the writing.

**Five dashboard views** (migration 193), each declared `WITH (security_invoker = true)` — mandatory
on PG17 (this project, confirmed via `mcp_supabase_list_projects`): a view without it defaults to
security-definer semantics (runs as the view owner, bypassing the base tables' RLS entirely), which
would turn every one of these into a cross-tenant read path despite AR-6.2's `orchestration_logs`
policy and this migration's own `ai_usage_log` fix above. Verified live post-apply via
`pg_class.reloptions` for all five. None declare their own `organization_id` filter — invoker security
means each base table's existing per-row RLS policy applies during the view's own scan, before
aggregation:

| View | Source table(s) | Grain |
|---|---|---|
| `v_orchestration_run_summary` | `orchestration_logs` | one row per `orchestration_id`: step/failure counts, evidence-validation state, derived `run_status` |
| `v_orchestration_daily_cost` | `ai_usage_log` (not `orchestration_logs`, which carries no cost columns by design — AR-6.2) | organization × day × model × agent_type × billing_path |
| `v_alert_activity_summary` | `alerts` | organization × type × severity: total/unread/undismissed/`pending_delivery_count` (critical + `notified_at IS NULL` — surfaces the AR-6.4 Part A backlog directly) |
| `v_budget_utilization` | `cost_budgets` | one row per budget scope: `spent_usd`/`budget_limit_usd`/`remaining_usd`/`pct_used`/`hard_stop` |
| `v_agent_reliability` | `orchestration_logs` | organization × `agent_type`: success rate, timeout count (`duration_ms > 60000`, same literal as AR-6.3 Rule 5) |

**`public.debug_view_is_security_invoker(p_view_name text)`** (migration 194) — a `SECURITY DEFINER`,
`service_role`-only introspection RPC that exists solely so
`src/__tests__/integration/alert-delivery.test.ts` can assert the `security_invoker` declaration above
from the mandated Supabase service-role client. PostgREST exposes no `pg_catalog` access, and this
suite may not open a raw `DATABASE_URL` connection (reserved for one-off scripts and
`integration-live/`) — this RPC is the only path. Parameterized query against `pg_class`, no dynamic
SQL, `REVOKE ALL ... FROM PUBLIC` (which also removes the implicit `anon`/`authenticated` grant every
new function gets by default on this project).

**Delivery path — `worker/alert-notifier.ts`, no new table.** The originating spec called for a Slack
Edge Function; `supabase/functions` does not exist in this repo, so delivery is one more interval-loop
module in the already-continuous Railway worker instead (same `start()`/`stop()`/`waitForIdle()` shape
as `worker/stuck-run-watchdog.ts`). Polls `alerts` for `severity = 'critical' AND notified_at IS NULL`
(the column AR-6.1 added specifically for this), posts a compact message to `FORGE_SLACK_WEBHOOK`
(existing convention — `forge-slack.ps1` reads the same var and no-ops when unset; mirrored here
rather than provisioning a second webhook), and sets `notified_at` only after a 2xx response. Message
text is passed through `redactSecrets()` (`src/lib/orchestration/orchestration-log.ts`, AR-6.2) before
it ever leaves the process — reused rather than re-implemented, so the redaction pattern set is one
list, not two. Full behavioral detail and the production-data incident this design was hardened
against mid-session: `STATE_OF_THE_BUILD.md`'s "AR-6.4" section.

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

---

## model_cost_reference (Migration 192, AR-6.4) — now consumed, not just seeded (AR-10.1, 2026-09-18)

| Column | Type | Notes |
|---|---|---|
| model | text PK | e.g. `claude-sonnet-4-6`, or `google_places` for a `'call'` row |
| pricing_unit | text NOT NULL DEFAULT 'token' | Added by migration 197 (AR-10.2). `'token'` (every pre-existing row) or `'call'`. A `CHECK` enforces the two shapes are mutually exclusive — see below. |
| input_usd_per_mtok | numeric(10,4), nullable | NOT NULL in spirit for `'token'` rows (enforced by the `CHECK`, not a column constraint since `'call'` rows must leave it NULL) |
| output_usd_per_mtok | numeric(10,4), nullable | Same as above |
| cache_write_usd_per_mtok | numeric(10,4), nullable | 5-minute-TTL rate; the 1-hour-TTL rate is `input_usd_per_mtok * 2`, not a separate column. Same nullability as above |
| cache_read_usd_per_mtok | numeric(10,4), nullable | Same as above |
| usd_per_call | numeric(10,4), nullable | Added by migration 197 (AR-10.2). NOT NULL in spirit for `'call'` rows, NULL for `'token'` rows — same `CHECK`-enforced mutual exclusivity |
| effective_from | date NOT NULL | |
| source | text NOT NULL | e.g. `https://claude.com/pricing` for a `'token'` row; for the one `'call'` row (`google_places`), a code-path citation instead — not independently re-verified against Google's pricing page the way the Anthropic rows were |

`model_cost_reference_pricing_unit_check` (migration 197): `pricing_unit = 'token'` requires all four
per-Mtok columns NOT NULL and `usd_per_call` NULL; `pricing_unit = 'call'` requires `usd_per_call`
NOT NULL and all four per-Mtok columns NULL. A row can never be both shapes at once.

Global reference table, no `organization_id` — rates apply identically to
every org. RLS: `SELECT` granted to `authenticated`, revoked from `anon`.

AR-6.4 created and seeded this table (rates verified live against
claude.com/pricing on 2026-09-17) and added a 180-day freshness test, but
nothing read it — every cost computation in the repo used its own hardcoded
per-MTok literal. AR-9.2 (same day as AR-10.1, earlier) fixed this for every
direct Anthropic call. AR-10.1 fixed the remaining gap: the PIL agent
framework's own internal tool-cost accounting
(`AgentRunner.useTool()`'s `"model_tokens"` costType), which used a flat,
unsourced $0.00002/token constant defined independently in 28 places across
`src/lib/pil/agents/**`, unrelated to this table. The single resolver for
both paths is `src/lib/pil/model-pricing.ts`:

- `priceUsage(model, inputTokens, outputTokens)` / `computeCostUsd(...)` —
  exact cost from a real input/output split (every direct Anthropic call).
- `pilBlendedTokenRateUsd()` — blended (input+output averaged) per-token
  rate for `PIL_AGENT_MODEL` (`"claude-sonnet-4-6"`), for the PIL framework's
  `useTool()` calls, which track one combined token count rather than a
  real split.

Both return a typed unpriced result (never a fabricated 0) and raise a
throttled `system_errors` alert (`error_type: "unpriced_model"`) when
`model` has no row here — the visible signal that replaces "spend silently
reads as free." Cached in-process for 5 minutes; this table changes rarely
enough that per-call reads would be pure overhead. Full detail, the real
per-file count (54, not AR-6.4's estimated "~29"), and the double-counting
bug found alongside the wrong-rate bug: `STATE_OF_THE_BUILD.md`'s "AR-10.1"
section.

---

## adapter_usage_log.api_cost_cents retired; model_cost_reference prices non-LLM calls too (AR-10.2, 2026-09-18)

**`public.adapter_usage_log`** (migration 076) is unchanged in shape.
`api_cost_cents integer NOT NULL DEFAULT 0` is now commented
`'Superseded by ai_usage_log.cost_usd (AR-10.2)...'` and no application code
writes it anymore — it sits at its table default on every new row.
`adapter_name`, `records_returned`, `cache_hit`, `called_at` are unaffected
and remain the live signal `GET /api/donor-discovery/connectors` and
`google-places-adapter.ts`'s own cache-first lookup depend on.

**`model_cost_reference`** gained the `pricing_unit`/`usd_per_call` columns
described above (migration 197), seeded with exactly one `'call'` row:

| model | pricing_unit | usd_per_call | source |
|---|---|---|---|
| google_places | call | 0.0320 | `google-places-adapter.ts`'s pre-existing `COST_PER_REQUEST_USD` constant (Basic Data SKU) |

Apollo and Hunter have no row — neither connector file contains any
cost/price/USD reference to seed one from, so `priceApiCall('apollo' | 'hunter', n)`
resolves `{priced:false, costUsd:null}` until a real rate is sourced.

**New resolver export:** `src/lib/pil/model-pricing.ts`'s
`priceApiCall(model: string, calls: number): Promise<ApiCallPriceResult>` —
sibling to `priceUsage()`/`computeCostUsd()`, same typed
`{priced:true,...} | {priced:false, costUsd:null}` contract, same throttled
`system_errors` unpriced-model alert. `priceUsage()` and
`pilBlendedTokenRateUsd()` were both guarded to only match `pricing_unit =
'token'` rows, so a `'call'` row (whose `input`/`output` are `null`) can
never silently produce `NaN` through the token-priced path.

**Two writers re-pointed at `ai_usage_log`:**
- `google-places-adapter.ts`'s `recordGooglePlacesCost()` — one row per
  `enumerate()` call that made ≥1 paid Nearby Search request, `model:
  'google_places'`, `input_tokens`/`output_tokens`/`total_tokens: 0` (a
  per-call API has no token split), `cost_usd` from `priceApiCall()`.
- `connectors/usage-log.ts`'s `logConnectorUsage()` — one row per Apollo/
  Hunter enrichment call, `model` set to the connector's provider key,
  `cost_usd: null` today (unpriced, per above).

**A dependent read had to move too:** the Faith Foundation $100/month
Places spend ceiling (`google-places-adapter.ts`) previously summed
`adapter_usage_log.api_cost_cents` directly — once that stopped being
written, the sum would have silently gone to 0 forever and the throttle
would never trip again. `faithFoundationMonthSpendUsd()` now sums
`ai_usage_log.cost_usd WHERE model = 'google_places'` for the same
organization/month window instead.

**FORGE gate hardened, not just relaxed:** `ar-10-rate-card-consumed.mjs`
check #3 previously excluded these two files by path (AR-10.1's carve-out).
That exclusion is removed — the gate now fails on any `api_cost_cents`
write anywhere in `src`/`worker`, matching the fact that `ai_usage_log` is
now the sole per-call cost ledger with zero exceptions.

Full detail: `STATE_OF_THE_BUILD.md`'s "AR-10.2" section.

## `agent_run_status` gains `'skipped'` a real writer; AG-29's producer restored (AR-14.1, 2026-09-19)

Migration 199 (AR-11.1) added `'skipped'` to `agent_run_status` back on
2026-09-17/18 for `run-logger.ts`'s AutoApply business-rule rejections, but
this doc's enum listing (line ~91) was never updated to reflect it — fixed
above, in place, this session.

This session gives `'skipped'` its second real writer:
`src/lib/agents/autonomous-base.ts`'s `completeRun()` now accepts
`status: "skipped"`, and `ag-29-knowledge-indexer` uses it for any pass that
finds 0 items and doesn't run pattern aggregation either — replacing what
was previously always `'completed'`, the exact ambiguity that let ~64,600
zero-work runs (96%+ of the entire `agent_runs` table) look identical to
real work for months. See `test-evidence/DATA_PIPELINE_AUDIT.md` §1 (root
cause) and this doc's own AR-13.3 coverage note above (`foundation_directory`
section) for the companion producer fix — no schema/column change, an
application-layer fix to what `flattenFoundationText()` reads.

Full detail, live before/after production numbers: `STATE_OF_THE_BUILD.md`'s
"AR-14.1" section.

### AR-14.1 recovery note (2026-09-19)

`foundation_directory.embedding` is no longer 100% NULL. Live before/after,
measured with `scripts/audit/ar-14-1-knowledge-pipeline-status.mjs`:

| | rows embedded |
|---|---|
| before (pre-deploy, 10:40 UTC) | **0 / 133,812** |
| after (+4.5 min live, 10:50 UTC) | **1,423**, filling at ~395 rows/min |

The AR-14.1 entries above described the fix as shipped when the commit had not
been pushed and Railway was still building the previous one. The schema claims
themselves were correct; only the deployment state was not.

`agent_runs.status = 'skipped'` still has no ag-29 row in production, because
no pass can find zero items until the ~132,000-row backlog drains (~5.6h from
10:50 UTC). The enum value itself is confirmed accepted live —
`autoapply_queue_processor` has written `skipped` rows since 2026-09-18.
