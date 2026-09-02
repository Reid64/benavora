# BENAVORA — Donor Discovery Architecture

## Version: 1.0
## Date: July 7, 2026
## Status: CANONICAL — Design document for the Donor Discovery engine. FORGE queues are generated from this document. No implementation begins until this doc is approved by Reid.

---

## 0. Product Definition

**Donor Discovery** is a top-level platform pillar (peer to Research, Opportunities, AutoApply, Draft Generator) that lets any subscribing nonprofit define, discover, enrich, score, and act on **any category of potential donor** — corporate in-kind donors, service providers, land banks, manufacturers, local businesses — not just grantmaking foundations.

**Nav placement:** Dashboard · Research · Opportunities · **Donor Discovery** · AutoApply · Draft Generator
**Route slug:** `/donor-discovery`
**Schema prefix:** `donor_discovery_*`

**Core differentiator:** taxonomy-driven, not source-driven. Subscribers select *what kind of business* and *where* — the engine resolves *how to find them*. No per-category hand-built scrapers.

**Faith Foundation validation case (first tenant):** land banks, automotive manufacturers, and site-development service donors (grading, septic installation, plumbing connection, well drilling) for donated land infrastructure. The engine must handle all of these through the same generic pipeline — if any requires custom code, the design has failed.

---

## 1. The Taxonomy Spine

### 1A. NAICS as the universal classifier

Every US business type has a NAICS code (~1,057 six-digit codes). This is the spine: subscribers never request "scrapers," they select taxonomy nodes.

Examples relevant to Faith Foundation:
| Target | NAICS |
|---|---|
| Site preparation / grading | 238910 |
| Septic system installation | 238910 / 562991 |
| Water well drilling | 237110 |
| Plumbing contractors | 238220 |
| Carpet cleaning | 561740 |
| Automobile manufacturing | 336111 |
| Building material dealers | 444180 |

### 1B. Non-NAICS entity types

Some targets are not businesses with NAICS codes. The taxonomy includes a parallel branch of **civic entity types**:
- Land banks (municipal/county entities; national directory ~300 via Center for Community Progress)
- Community foundations (already in `community_foundations`, migration 062)
- Corporate foundations (already in IRS BMF/990 pipeline)
- Municipal surplus-property programs
- Trade associations (used as *directories of members*, a meta-source)

### 1C. Schema

```
donor_discovery_taxonomy
- id uuid PK
- kind enum('naics','civic','association')
- code text                  -- NAICS code or civic slug
- label text
- parent_id uuid NULL        -- tree structure
- default_sources jsonb      -- which acquisition adapters apply
- created_at timestamptz
```
Seeded once (shared, no org_id). Subscribers reference nodes; they never edit the taxonomy.

---

## 2. Acquisition Layers (generic by design)

Four layers. Every layer writes to the same normalized prospect schema. New sources are new *adapters*, never new pipelines.

### 2A. Registry layer — enumerate companies
Adapters, in priority order:
1. **Google Places API** — universal coverage, category + radius search. Primary enumerator for local/regional service businesses. Cost-controlled via per-request caching into shared directory.
2. **State contractor license boards** — structured rosters for trades (TX TDLR first; one adapter per state, config-driven URL/parse map, added incrementally).
3. **State Secretary of State registries** — business entity search by NAICS/keyword where APIs exist.
4. **Civic directories** — land bank directory, community foundation locator: scraped once, refreshed quarterly by cron.
5. **Trade association member lists** — meta-adapter: association page → member roster extraction via Claude.

### 2B. Enrichment layer — understand each company
For each enumerated prospect, a Claude enrichment agent (pattern already proven in `foundation-enrichment` lanes) visits the company website once and extracts a structured record:
- has_giving_program bool
- has_donation_form bool + form URL (→ AutoApply handoff)
- csr_page_url, giving_focus_areas text[]
- in_kind_history_signals text[] (press mentions, sponsorship pages)
- decision_contacts jsonb (name, title, email/phone if published)
- service_area, company_size_estimate

### 2C. Signal layer — external evidence
- IRS 990/BMF (already ingested): corporate foundation linkage by name/EIN fuzzy match
- News search (existing SearXNG integration): donation/sponsorship announcements
- Grants/gifts already recorded in platform-wide shared directory from other tenants' confirmed outcomes (anonymized — see §5)

### 2D. Scoring layer
`donation_likelihood_score` 0-100 per prospect per request context:
- +signals: giving program found, donation form found, prior in-kind evidence, foundation linkage, geographic match, size match to ask
- Weights configurable per org; Claude-generated rationale string stored with every score (explainability is a sales feature)

---

## 3. Request-Queue Architecture (multi-tenant core)

```
donor_discovery_requests
- id uuid PK
- organization_id uuid FK    -- RLS
- name text                  -- "Septic installers near Austin"
- taxonomy_ids uuid[]
- geography jsonb            -- {center, radius_mi} | {states[]} | {national:true}
- status enum('queued','enumerating','enriching','scoring','complete','failed')
- counts jsonb               -- {enumerated, enriched, scored}
- created_by uuid, created_at, completed_at

donor_discovery_prospects
- id uuid PK
- organization_id uuid FK    -- RLS (tenant's view/annotations)
- directory_id uuid FK       -- link to shared directory record
- request_id uuid FK
- score int, score_rationale text
- pipeline_stage enum('new','reviewing','contacted','applied','received','rejected','archived')
- notes text, assigned_to uuid

donor_discovery_directory    -- SHARED, no org_id (like foundation_directory)
- id uuid PK
- legal_name, dba_name, naics_codes text[], civic_kind text NULL
- website, hq_address, geo point, phone
- enrichment jsonb           -- §2B record
- enriched_at timestamptz    -- staleness for re-enrichment (180-day TTL)
- source_adapters text[]
```

**Compounding moat:** enumeration and enrichment write to the shared directory. Tenant B requesting "plumbers in Austin" after Tenant A pays zero enumeration cost and gets instant results. Tenant-private data (notes, pipeline stage, scores, contacts acquired via the tenant's own connector keys) stays in `donor_discovery_prospects` under RLS.

**Worker model:** requests processed by the existing Railway worker pattern (AutoApply worker architecture reused). Enumeration and enrichment are long-running; never in Vercel routes. Vercel routes only enqueue and read.

---

## 4. Dedicated Dashboard (`/donor-discovery`)

Top-level nav item. Pages:
1. **Overview** — active requests with progress, prospect pipeline funnel by stage, top-scored new prospects, "Scout report" weekly digest block
2. **New Discovery** — wizard: pick taxonomy nodes (searchable tree) → geography → optional filters (size, must-have donation form) → launch
3. **Prospects** — filterable table (taxonomy, geography, score, stage) with Badge-system status pills; bulk actions: assign, advance stage, send to AutoApply, export
4. **Prospect detail** — enrichment record, score rationale, contacts, activity timeline, one-click "Queue in AutoApply" when donation form exists
5. **Connectors** — third-party integration management (§6)

Design system: existing tokens (surface/sunken headers, Badge variants, primary buttons). Icon hue for Donor Discovery: emerald (money/giving family).

---

## 5. Data Boundaries & Compliance

**Shared vs private:**
- Shared directory: company facts (name, NAICS, website, public enrichment). Public information only.
- Tenant-private: pipeline stages, notes, scores, outreach history, and any contact data acquired through the tenant's own paid connector keys (contractually theirs, never shared cross-tenant).

**Crawler core (non-negotiable, built first):**
- Per-domain rate limiter (token bucket, default 1 req/5s/domain) shared across ALL tenants' requests
- robots.txt fetch + respect, cached 24h
- Per-source ToS registry table; adapters check a `scrape_allowed` flag; Google Places used via paid API (no SERP scraping)
- User-agent identifies the platform; contact URL in UA string
- Kill switch per adapter (env flag)

**Outreach compliance:** contact emails feed the existing Sales/Outreach engine which already handles unsubscribe; CAN-SPAM ownership stays there, not duplicated here.

---

## 6. Connector Framework (BYO-key third-party enrichment)

**Pattern:** platform-native engine is included; premium contact-enrichment connectors are one-click activations using the customer's own API key. BYO-key keys stored via the existing encrypted BYO-key infrastructure (July 4 audit work).

```
donor_discovery_connectors
- id, organization_id FK, provider enum, encrypted_api_key, status, activated_at
```

**V1 connector list (pending Reid confirmation of vendors):**
| Provider | Purpose | Notes |
|---|---|---|
| Apollo.io | Contact + company enrichment | Likely the "Amplify" referenced; confirm |
| Hunter.io | Email discovery/verification | Cheap, simple API |
| (Phase 2) ZoomInfo / Clay | Deep enrichment | Enterprise tier |

Connector results write into `donor_discovery_prospects.enrichment_private` (tenant-scoped), merge-displayed with shared enrichment in the UI. Managed/markup tier deferred until volume justifies vendor contracts.

---

## 7. AutoApply Handoff

When enrichment finds `has_donation_form=true`:
- Prospect detail and Prospects table show "Queue in AutoApply"
- Creates a funder record (existing `funders` schema) + AutoApply queue item with the form URL
- AutoApply's existing approval gate, risk engine, and session audit apply unchanged

This closes the loop: **Discover → Score → Apply → Track outcome**, and confirmed outcomes feed back into scoring weights (§2D).

---

## 8. Build Phasing (FORGE queues generated from this doc)

**Phase 1 — Foundation (1 overnight queue, ~8 prompts):**
migrations (taxonomy, requests, prospects, directory, connectors) · taxonomy seed script (NAICS + civic) · crawler core (rate limiter, robots, ToS registry) · Google Places adapter · request queue worker skeleton · RLS + tests

**Phase 2 — Enrichment & scoring (1 queue, ~7 prompts):**
Claude enrichment agent · 990/BMF linkage · scoring engine + rationale · re-enrichment TTL cron · directory dedup (name+domain fuzzy)

**Phase 3 — Dashboard (1 queue, ~8 prompts):**
nav + routes · Overview · New Discovery wizard · Prospects table · Prospect detail · Badge/pipeline stages · Playwright specs

**Phase 4 — Adapters & connectors (1 queue, ~7 prompts):**
TX license board adapter · land bank directory adapter · trade-association meta-adapter · Apollo + Hunter connectors on BYO-key infra · Connectors page

**Phase 5 — Loop closure (1 queue, ~5 prompts):**
AutoApply handoff · outcome feedback into scoring · weekly digest email · Scout report block on Overview

Each phase ends with governance-doc updates and a build+Playwright gate. Nothing in a later phase starts until the prior phase's gate passes.

---

## 9. Open Decisions (Reid)

1. Confirm connector vendors for V1 (Apollo.io? Hunter.io? others?)
2. Google Places API budget ceiling per month (drives enumeration throttling defaults)
3. Pricing posture: included in existing tiers vs. premium add-on (affects feature-flag design in Phase 1)
4. Directory seeding: import the 298K nonprofit prospect CSV's *corporate* records into the shared directory at Phase 1, or keep that dataset exclusively in Sales Outreach?
