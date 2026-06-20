# BENAVORA — Grant Intelligence Library Architecture

## Version: 1.0
## Date: June 20, 2026
## Status: CANONICAL — Governs all Grant Intelligence Library implementation. Supplements AUTOAPPLY_ARCHITECTURE.md and WORKER_ARCHITECTURE.md.

---

## 1. Strategic Vision

The Grant Intelligence Library transforms Benavora from "AI writes grants" to "AI trained on the collective intelligence of funded proposals." Instead of generating drafts from generic model training, the draft generator retrieves proven examples, scoring criteria, evidence data, and winning patterns via RAG (Retrieval-Augmented Generation) before constructing any output.

This is Benavora's moat. No competitor has this dataset. Every funded proposal ingested makes every future draft better for every customer.

---

## 2. Architecture Overview

### Two Knowledge Layers

| Layer | Scope | Purpose |
|-------|-------|---------|
| Organization KB (existing) | Per-org, private | Mission, programs, board, narratives, answers, financials |
| Grant Intelligence Library (NEW) | Global, shared | Funded proposals, rubrics, logic models, evidence data, patterns |

The draft generator queries BOTH layers. The org KB provides organizational facts (never fabricated). The intelligence library provides structural patterns, evidence data, and scoring guidance.

### Technology Stack Addition

- **pgvector** extension on Supabase (vector similarity search)
- **OpenAI text-embedding-3-small** for embedding generation (~$0.02/1M tokens)
- **RAG retrieval** via cosine similarity on vectorized document sections
- All intelligence data stored in Supabase under a `grant_intelligence` schema prefix

---

## 3. Nine Knowledge Bases

### KB 1: Funded Proposals Library (Night 1 — MVP)

**Value:** Highest. Actual funded applications are the gold standard for what works.

**Sources:**
- NIH Reporter funded application library (openly published with reviewer comments)
- University grant repositories (public)
- State grant portals (public records)
- Foundation annual reports describing funded projects
- FOIA requests (federal, where applicable)
- Nonprofit-published successful grant libraries

**What to extract per proposal:**
- Executive summary
- Need statement
- Problem framing / gap analysis
- Program design / activities
- Outcomes and evaluation plan
- Sustainability section
- Budget narrative
- Funder category and grant type
- Award amount
- Reviewer comments (when available)

**Tables:**
```sql
CREATE TABLE intelligence_funded_proposals (
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
  metadata jsonb,
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE intelligence_proposal_sections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id uuid REFERENCES intelligence_funded_proposals(id) ON DELETE CASCADE,
  section_type text NOT NULL,
  section_text text NOT NULL,
  quality_score numeric(3,1),
  embedding vector(1536),
  created_at timestamptz DEFAULT NOW()
);
```

**Section types:** `executive_summary`, `need_statement`, `problem_framing`, `program_design`, `outcomes`, `evaluation_plan`, `sustainability`, `budget_narrative`, `methodology`, `capacity`, `partnerships`

---

### KB 2: Reviewer Scoring Rubrics (Night 2)

**Value:** High. Reviewers score against rubrics, not vibes. Training the AI to optimize for scoring criteria rather than "sounding good" is a fundamental shift.

**Sources:**
- Federal NOFO scoring criteria (extracted from parsed NOFAs — already in the system)
- Foundation evaluation criteria (from funder websites)
- Reviewer guidance manuals (NIH, NSF, SAMHSA, HUD published guides)
- Technical review checklists

**What to extract:**
- Scoring dimensions (e.g., Need 20pts, Approach 25pts, Evaluation 15pts)
- What earns full marks per dimension
- Common deductions
- Reviewer pet peeves and preferences

**Tables:**
```sql
CREATE TABLE intelligence_scoring_rubrics (
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
```

**Draft generator integration:** Before drafting, retrieve rubrics matching the funder/category. Inject into the Claude prompt: "The reviewer will score this on the following dimensions: {dimensions}. Optimize every sentence to maximize score."

---

### KB 3: Logic Model Library (Night 2)

**Value:** Medium-High. Many federal grants require logic models. Most nonprofits struggle to create them.

**Structure:** Inputs → Activities → Outputs → Outcomes → Impact

**Pre-built categories:**
- Homelessness prevention and intervention
- Reentry / second chance programs
- Addiction recovery and treatment
- Workforce development
- Affordable housing development
- Youth programs and mentoring
- Veterans services
- Faith-based social services
- Food insecurity programs
- Domestic violence services

**Tables:**
```sql
CREATE TABLE intelligence_logic_models (
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
```

**Draft generator integration:** When a grant requires a logic model, auto-generate one from the closest matching template + org-specific program data.

---

### KB 4: Need Statement Database (Night 3)

**Value:** High. Need statements require current, local statistics. Most nonprofits use outdated data or make claims without evidence.

**Data Sources and APIs:**
- Census Bureau API (poverty rates, demographics, income, housing)
- HUD (homeless counts, housing affordability, PIT counts, CoC data)
- SAMHSA (substance abuse prevalence, treatment gaps, mental health)
- BLS (unemployment, workforce statistics)
- CDC (health outcomes, mortality, disease prevalence)
- DOJ/BJS (crime, incarceration, reentry statistics)
- Local Continuums of Care (homelessness data by geography)

**Tables:**
```sql
CREATE TABLE intelligence_need_data (
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
```

**Geographic levels:** `national`, `state`, `county`, `city`, `zip`, `coc` (Continuum of Care)

**Draft generator integration:** When generating a need statement, auto-retrieve relevant statistics by: org geography + grant category + data recency. Produce evidence-backed statements with proper citations.

---

### KB 5: Winning Narrative Patterns (Night 6)

**Value:** High. Analysis layer on top of funded proposals. Discovers recurring structures that win.

**Pattern structure:** `Problem → Evidence → Gap → Program → Measurable Outcome → Sustainability`

**What to detect:**
- Opening hook patterns (statistic-led vs. story-led vs. authority-led)
- Evidence density (citations per paragraph)
- Outcome specificity (vague "improve lives" vs. "reduce recidivism by 15% within 12 months")
- Transition patterns between sections
- Funder-specific language preferences
- Word count distributions per section type

**Tables:**
```sql
CREATE TABLE intelligence_narrative_patterns (
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
```

**Draft generator integration:** Enforce winning patterns in generated drafts. Claude prompt includes: "Follow this narrative structure: {pattern}. Here are examples of funded proposals that used this pattern: {examples}."

---

### KB 6: Budget Justification Library (Night 4)

**Value:** Medium-High. Most AI grant writers produce weak budgets. Real budget narratives require specific justification language.

**What to collect:**
- Personnel justification templates (FTE calculations, fringe rates, salary basis)
- Supply and equipment justifications
- Travel justifications (per diem, mileage, conference)
- Contractual / consultant justifications
- Match and cost-share explanations
- Indirect cost rate agreements and language
- Federal cost principles references (2 CFR 200)

**Tables:**
```sql
CREATE TABLE intelligence_budget_templates (
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
```

---

### KB 7: Evaluation Framework Library (Night 4)

**Value:** Medium-High. Many nonprofits lose grants because they cannot explain how they will measure success.

**What to collect:**
- KPI libraries by program type
- Outcome measurement methodologies
- Data collection instrument descriptions
- Reporting framework templates
- Logic model to evaluation plan mappings

**Tables:**
```sql
CREATE TABLE intelligence_evaluation_frameworks (
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
```

---

### KB 8: Grantmaker Intelligence (Night 5)

**Value:** High. Turns the funder database from a contact list into a recommendation engine.

**Profile data per funder:**
- Giving priorities and focus areas
- Average award size and range
- Geographic preferences
- Typical language and terminology
- Previously funded organizations (from 990 data — already imported)
- Common application requirements
- Decision timeline patterns
- Board composition and connections

**Tables:**
```sql
CREATE TABLE intelligence_grantmaker_profiles (
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
```

**Leverages existing data:** The 133K foundations in `foundation_directory` and 54K foundation websites already scraped provide the raw material. This KB enriches that data into actionable intelligence.

---

### KB 9: Post-Award Reports (Night 5)

**Value:** High (hidden gem). Reveals what funders actually cared about after the money was spent.

**Sources:**
- Foundation annual reports (outcomes sections)
- Grantee impact reports (often published publicly)
- Federal grant closeout reports
- Nonprofit annual reports with funder acknowledgments

**What to extract:**
- What outcomes were highlighted (what the funder chose to showcase)
- What metrics were reported
- What language survived scrutiny (funder-approved framing)
- What follow-on funding resulted

**Tables:**
```sql
CREATE TABLE intelligence_post_award_reports (
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
```

---

## 4. Grant DNA Scoring System (Night 6)

For every funded proposal ingested, score across dimensions:

| Dimension | Weight | What It Measures |
|-----------|--------|------------------|
| Need Statement Quality | 15% | Evidence density, local data, gap articulation |
| Evidence Strength | 15% | Citations, data recency, source authority |
| Outcome Specificity | 15% | Measurable, time-bound, realistic targets |
| Evaluation Depth | 10% | KPIs, collection methods, reporting plan |
| Sustainability Quality | 10% | Post-funding plan, diversified revenue, partnerships |
| Budget Alignment | 10% | Budget matches narrative, justified line items |
| Program Design | 15% | Logic model coherence, activities-to-outcomes chain |
| Reviewer Friendliness | 10% | Formatting, readability, rubric alignment |

**Table:**
```sql
CREATE TABLE intelligence_grant_dna_scores (
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
```

Over time, this creates a proprietary dataset. The composite score becomes a benchmark: "Your draft scores 72/100 against funded proposals in this category. Here's how to improve."

---

## 5. RAG Retrieval Flow

### Modified Draft Generation Pipeline

```
1. User selects opportunity + template type
2. Load org KB (existing — mission, narratives, answers, programs)
3. NEW: Query intelligence library:
   a. Embed the opportunity description + requirements
   b. Retrieve top-5 similar funded proposal sections (by section_type matching template)
   c. Retrieve matching scoring rubric (by funder/category)
   d. Retrieve matching logic model template (if grant requires one)
   e. Retrieve relevant need data (by org geography + grant category)
   f. Retrieve matching narrative patterns
   g. Retrieve budget templates (if budget narrative requested)
   h. Retrieve evaluation frameworks (if evaluation plan requested)
4. Construct enhanced Claude prompt:
   - System: grant writer role + never fabricate rule
   - Org context: KB entries (factual basis)
   - Intelligence context: funded examples, rubric, patterns, evidence data
   - Scoring instruction: "Optimize for these scoring dimensions: {rubric}"
   - Pattern instruction: "Follow this winning structure: {pattern}"
   - Evidence instruction: "Use these statistics with citations: {need_data}"
   - Task: generate draft
5. Generate draft with enhanced confidence scoring
6. Return draft + score + sources (both KB and intelligence library citations)
```

### Embedding Strategy

- Model: `text-embedding-3-small` (1536 dimensions)
- Chunk size: ~500 tokens per section (natural section boundaries, not arbitrary splits)
- Overlap: 50 tokens between chunks
- Batch processing: 100 embeddings per API call
- Cost: ~$0.02 per million tokens (negligible at this scale)

---

## 6. Night-by-Night Build Schedule

### Night 1: Infrastructure + NIH Pipeline (Combined with Phase 3C Worker)
FORGE prompts 1-12: Phase 3C worker infrastructure
FORGE prompts 13-24: Intelligence Library MVP
- Enable pgvector extension
- Create all intelligence tables (schema only — all 9 KBs)
- NIH funded application scraper + parser
- Section extraction pipeline (Claude API)
- OpenAI embedding generation pipeline
- RAG retrieval function
- Modify draft generator to query intelligence library
- Intelligence Library browser UI at `/intelligence-library`
- Supabase Storage bucket for raw documents

### Night 2: Reviewer Rubrics + Logic Models
- Federal NOFO rubric extractor (builds on existing NOFA parser)
- Rubric database population from parsed NOFAs
- NIH/NSF/SAMHSA reviewer guide ingestion
- Logic model template database (10 categories)
- Logic model auto-generator
- Draft generator rubric integration ("optimize for score")
- Logic model UI component in draft generator

### Night 3: Need Statement Database
- Census Bureau API integration
- HUD API integration (PIT counts, housing data)
- SAMHSA data integration
- BLS unemployment data integration
- CDC health data integration
- Geographic matching engine (org zip → county → state → national fallback)
- Auto-citation generator
- Need statement auto-generation from data
- Data refresh scheduling (quarterly)

### Night 4: Budget + Evaluation Libraries
- Budget justification template database
- Federal cost principles reference library
- Budget narrative auto-generator enhancement
- Evaluation framework template database
- KPI library by program category
- Data collection method templates
- Evaluation plan auto-generator
- Integration into draft generator for budget and evaluation template types

### Night 5: Grantmaker Intelligence + Post-Award Reports
- Foundation 990 data enrichment pipeline (leverages existing 133K foundations)
- Foundation website scraping for priorities and language (leverages 54K URLs)
- Grantmaker profile builder (aggregate 990 grants made data)
- Recommendation engine (match org profile to funder priorities)
- Post-award report ingestion pipeline
- Outcome extraction and categorization
- Funder language pattern analysis
- Integration into draft generator (funder-specific language guidance)

### Night 6: Patterns + Grant DNA
- Narrative pattern extraction engine (analyze funded proposals corpus)
- Pattern classification and frequency counting
- Win rate calculation per pattern type
- Grant DNA scoring pipeline (score every ingested proposal)
- Composite score calculator
- Draft benchmarking ("your draft vs funded proposals")
- Pattern enforcement in draft generator
- Analytics dashboard for intelligence library stats

### Night 7: Integration + Polish
- Cross-library search UI (unified search across all 9 KBs)
- Intelligence library dashboard (ingestion stats, coverage maps, data freshness)
- Draft generator intelligence panel (shows which intelligence sources were used)
- Confidence scoring recalibration (factor in intelligence library match quality)
- Data freshness monitoring and stale data alerts
- Admin tools for manual ingestion and quality review
- Performance optimization (query caching, embedding index tuning)

---

## 7. Data Ingestion Runs (Parallel to FORGE Builds)

These run on the secondary machine during daytime, independent of FORGE:

| Run | Source | Est. Duration | Est. Records |
|-----|--------|---------------|--------------|
| 1 | NIH funded applications | 4-8 hours | 500-1,000 proposals |
| 2 | Census Bureau API | 2-4 hours | 50,000+ data points |
| 3 | HUD homeless counts | 1-2 hours | 5,000+ records |
| 4 | SAMHSA treatment data | 1-2 hours | 10,000+ records |
| 5 | BLS workforce data | 1-2 hours | 20,000+ records |
| 6 | Foundation website scraping | 8-12 hours | 54,000 sites |
| 7 | 990 grants-made extraction | 4-6 hours | 133,000 foundations |
| 8 | Post-award report collection | 4-8 hours | varies |

---

## 8. Pricing Impact

The Grant Intelligence Library is a platform-wide asset. All tiers benefit, but depth varies:

| Tier | Intelligence Access |
|------|-------------------|
| Starter | Basic need data + 3 funded examples per draft |
| Professional | Full need data + 10 funded examples + rubric optimization |
| Enterprise | Everything + Grant DNA benchmarking + custom intelligence ingestion |
| Consultant | Everything + cross-client pattern analysis + white-label intelligence branding |

This justifies the tier pricing — Starter customers get better drafts than any competitor. Enterprise customers get a proprietary intelligence advantage.

---

## 9. Competitive Moat Analysis

Every funded proposal ingested creates compounding value:
- More proposals → better pattern detection → higher draft quality → more customers → more outcome data → better recursive learning
- No competitor can replicate this dataset without doing the same multi-source ingestion work
- The Grant DNA scoring system creates a proprietary benchmark that becomes an industry reference
- First-mover advantage: the first 1,000 funded proposals create the foundation; subsequent proposals add incrementally

---

## Document Authority

This document is CANONICAL for the Grant Intelligence Library architecture. It governs all intelligence-related tables, ingestion pipelines, RAG retrieval, and draft generator integration. It is complementary to AUTOAPPLY_ARCHITECTURE.md (which governs AutoApply) and WORKER_ARCHITECTURE.md (which governs the Railway worker).
