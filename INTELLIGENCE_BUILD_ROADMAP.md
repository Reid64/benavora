# BENAVORA — Intelligence Library Build Roadmap

## Version: 1.0
## Date: June 20, 2026
## Status: ACTIVE — Tracks the multi-night FORGE build schedule for the complete Grant Intelligence Library.
## Reference: GRANT_INTELLIGENCE_ARCHITECTURE.md (canonical architecture), WORKER_ARCHITECTURE.md (worker details)

---

## Build Schedule

### Night 1: Phase 3C Worker + Intelligence Library MVP (TONIGHT)
**Queue:** queue-night1.yaml (22 prompts)
**Delivers:**
- Railway worker infrastructure (entry point, queue processor, heartbeat, rate limiter, Dockerfile)
- AutoApply dashboard enhancements (worker status, queue panel, batch selection, submission history)
- pgvector + all 11 intelligence tables (schema only)
- OpenAI embedding pipeline
- RAG retrieval integration into draft generator
- NIH funded application ingestion script
- Section extractor (Claude API)
- Intelligence Library browser UI + manual ingestion modal
**Post-run manual steps:**
- git add/commit/push
- Apply migrations 047 + 048 via Supabase SQL Editor
- Enable pgvector extension in Supabase dashboard
- Set OPENAI_API_KEY in Vercel env vars
- Test NIH ingestion: npx tsx src/scripts/ingest-nih-proposals.ts --limit 10
- Railway project creation + deployment (separate guided session)

---

### Night 2: Reviewer Scoring Rubrics + Logic Model Library
**Queue:** queue-night2.yaml (TBD — produce day of)
**Delivers:**
- Federal NOFO rubric extractor (builds on existing NOFA parser output)
- Rubric database population from already-parsed NOFAs
- NIH/NSF/SAMHSA/HUD reviewer guide ingestion scripts
- Rubric-to-draft integration ("optimize for these scoring dimensions")
- Logic model template database (10+ program categories: homelessness, reentry, recovery, workforce, housing, youth, veterans, faith-based, food insecurity, domestic violence)
- Logic model auto-generator from program type + org data
- Logic model UI component in draft generator
**Data sources:** Existing parsed NOFAs (already in system) + public reviewer guidance PDFs
**Estimated prompts:** 12-15

---

### Night 3: Need Statement Database
**Queue:** queue-night3.yaml (TBD)
**Delivers:**
- Census Bureau API integration (poverty rates, demographics, income, housing stats)
- HUD API integration (PIT homeless counts, housing affordability, CoC data)
- SAMHSA data integration (substance abuse prevalence, treatment gaps, mental health)
- BLS API integration (unemployment, workforce statistics by geography)
- CDC data integration (health outcomes, mortality, disease prevalence)
- Geographic matching engine (org zip → county → state → national fallback)
- Auto-citation generator (every statistic includes a proper citation)
- Need statement auto-generation from matched data
- Data refresh scheduling (quarterly re-pull)
**Data sources:** All federal API endpoints (Census, HUD Exchange, SAMHSA, BLS, CDC WONDER)
**Estimated prompts:** 15-18
**Note:** Each API has its own authentication, format, and rate limits. This is the most complex single-night build.

---

### Night 4: Budget Justification + Evaluation Framework Libraries
**Queue:** queue-night4.yaml (TBD)
**Delivers:**
- Budget justification template database by category (personnel, supplies, equipment, travel, contractual, indirect)
- Federal cost principles reference library (2 CFR 200 excerpts)
- Fringe rate and indirect cost rate examples
- Match/cost-share explanation templates
- Budget narrative auto-generator enhancement (replaces basic Agent 06 output)
- Evaluation framework template database by program category
- KPI library (measurable indicators per program type)
- Data collection method templates (surveys, intake forms, case management tracking)
- Reporting methodology templates
- Evaluation plan auto-generator
- Integration into draft generator for budget and evaluation template types
**Data sources:** OMB circulars, federal grant guidance documents, published budget examples
**Estimated prompts:** 12-14

---

### Night 5: Grantmaker Intelligence + Post-Award Reports
**Queue:** queue-night5.yaml (TBD)
**Delivers:**
- Foundation 990 data enrichment pipeline (extract grants-made data from existing 133K foundation records)
- Foundation website priority/language scraping (leverages existing 54K URLs from IRS 990 XML enrichment)
- Grantmaker profile builder (aggregate: priorities, avg award size, geographic focus, common keywords)
- Funder recommendation engine (match org profile + program to funder priorities, score fit)
- Post-award report ingestion pipeline (scrape nonprofit annual reports, foundation impact reports)
- Outcome extraction and categorization from post-award reports
- Funder language pattern analysis (what terminology funders use in their own publications)
- Integration into draft generator (funder-specific language guidance per profile)
**Data sources:** Existing foundation_directory table, foundation websites, nonprofit annual reports
**Estimated prompts:** 14-16

---

### Night 6: Winning Narrative Patterns + Grant DNA Scoring
**Queue:** queue-night6.yaml (TBD)
**Delivers:**
- Narrative pattern extraction engine (analyze all ingested funded proposals for recurring structures)
- Pattern classification: opening hooks (statistic-led, story-led, authority-led), evidence density, outcome specificity, transition patterns, section length distributions
- Pattern frequency counting and win rate calculation
- Grant DNA scoring pipeline (score every ingested proposal across 8 dimensions)
- Composite score calculator with weighted formula
- Draft benchmarking feature ("Your draft scores 72/100 against funded proposals in this category. Here is how to improve:")
- Improvement suggestions per dimension (specific, actionable)
- Pattern enforcement in draft generator prompts
- Analytics dashboard for intelligence library statistics (total proposals, coverage by category, avg scores)
**Data sources:** Funded proposals already ingested (Nights 1-5 data)
**Estimated prompts:** 12-14
**Dependency:** Requires sufficient funded proposals ingested from Night 1+ data runs

---

### Night 7: Cross-Library Integration + Polish
**Queue:** queue-night7.yaml (TBD)
**Delivers:**
- Unified search UI across all 9 knowledge bases (single search bar, results grouped by KB type)
- Intelligence library dashboard (ingestion stats, coverage heat maps by category/geography, data freshness indicators)
- Draft generator intelligence panel (shows which intelligence sources were used in each draft, with similarity scores)
- Confidence scoring recalibration (factor in intelligence library match quality — better matches = higher confidence)
- Data freshness monitoring (flag stale data: Census > 1 year, need data > 2 years)
- Admin tools for manual quality review of ingested data (approve/reject/edit sections)
- Embedding index tuning (adjust ivfflat lists parameter based on actual data volume)
- Performance optimization (query caching for repeated intelligence lookups)
- Tier-based access controls (Starter: 3 examples, Professional: 10 + rubric, Enterprise: full + DNA)
- Final governance document updates
**Estimated prompts:** 10-12

---

## Parallel Data Ingestion Runs (Secondary Machine)

These run independently of FORGE builds, populating the tables that the code queries:

| Priority | Script | Source | Est. Duration | Est. Records | Run After |
|----------|--------|--------|---------------|--------------|-----------|
| 1 | ingest-nih-proposals.ts | NIH Reporter | 4-8 hours | 500-1,000 proposals | Night 1 |
| 2 | ingest-census-data.ts | Census Bureau API | 2-4 hours | 50,000+ data points | Night 3 |
| 3 | ingest-hud-data.ts | HUD Exchange | 1-2 hours | 5,000+ records | Night 3 |
| 4 | ingest-samhsa-data.ts | SAMHSA | 1-2 hours | 10,000+ records | Night 3 |
| 5 | ingest-bls-data.ts | BLS API | 1-2 hours | 20,000+ records | Night 3 |
| 6 | scrape-foundation-priorities.ts | Foundation websites | 8-12 hours | 54,000 sites | Night 5 |
| 7 | extract-990-grants-made.ts | IRS 990 data | 4-6 hours | 133,000 foundations | Night 5 |
| 8 | ingest-post-award-reports.ts | Nonprofit reports | 4-8 hours | varies | Night 5 |

---

## Total Timeline

- **Code builds:** 7 nights
- **Data ingestion:** 3-5 days (parallel with code builds)
- **Total to full operational:** 10-12 days from Night 1
- **Intelligence Library producing value:** After Night 1 + first NIH ingestion run (Day 2)

---

## Document Authority

This roadmap is a planning document subordinate to GRANT_INTELLIGENCE_ARCHITECTURE.md. Individual queue files (queue-night2.yaml through queue-night7.yaml) will be produced the day of each build, referencing the canonical architecture doc for specifications.
