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
2. **State contractor license boards** — structured rosters for trades (TX TDLR first; one adapter per state, config-driven URL/parse map, added incrementally). **Built:** `src/lib/donor-discovery/adapters/tx-tdlr-adapter.ts` (added 2026-07-10) — TDLR Lookup.aspx licensee search (`SearchType=Business&LicenseType=<code>`) for five license types (ELEC, PLMB, HVAC, ELEV, BLRP), each mapped to a NAICS code already in the taxonomy seed (238210, 238220 ×2, 238290 ×2), filtered to active licenses (expiration date after today), parsed with `node-html-parser` matching the results grid by header text rather than a hardcoded column index. Implements the generic `RegistryAdapter` interface (naics-driven license-type resolution); `geography`/`organizationId` are accepted but unused — TDLR's statewide public dataset has no lat/lng or per-org key to filter/gate by. Fetched through `fetchCompliant` (crawler-core.ts) like every other scraped source. `scripts/ingest-tx-tdlr.ts` (`pnpm ingest:tdlr`) drives all five license types in one run.
3. **State Secretary of State registries** — business entity search by NAICS/keyword where APIs exist.
4. **Civic directories** — land bank directory, community foundation locator: scraped once, refreshed quarterly by cron. **Built:** `src/lib/donor-discovery/adapters/land-bank-adapter.ts` (added 2026-07-10) — scrapes the Center for Community Progress land bank directory page into `donor_discovery_directory` rows (`civic_kind = 'land_bank'`, `source_adapters` containing `land_bank_directory`), parsed with `node-html-parser` matching the directory table by header text (org name/organization + state/city/location) rather than a hardcoded column index. A single fixed-page scrape, not a `RegistryAdapter` — no NAICS code or geography to enumerate against. Fetched through `fetchCompliant`. `scripts/ingest-land-banks.ts` (`pnpm ingest:landbanks`) drives it.
5. **Trade association member lists** — meta-adapter: association page → member roster extraction via Claude.
6. **SAM.gov (`src/lib/donor-discovery/adapters/samgov-adapter.ts`, added 2026-07-10)** — federal-registration signal, platform-managed key (`SAM_GOV_API_KEY`), rate-limited to 450 req/min: (a) Entity Management API v3 entities registered for federal financial assistance (`purposeOfRegistrationCode=Z2`) by NAICS code, and (b) Contract Opportunities API v2 Award Notices (`ptype=a`) from the last 90 days, whose `awardee` block identifies companies the federal government recently paid — both a positive signal for corporate in-kind donor capacity. `scripts/ingest-samgov.ts` (`pnpm ingest:samgov`) drives it across ~50 NAICS codes spanning construction trades, site development, professional services, food service, and transportation.

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
- ProPublica Nonprofit Explorer API (free, no key — `src/lib/donor-discovery/adapters/propublica-adapter.ts`): given a directory row's EIN, pulls the latest 990 filing's total_revenue/total_expenses/total_assets/ntee_code/filing_year/form_type/pdf_url into `enrichment.propublica`, 90-day TTL (`enrichment.propublica_enriched_at`), 1 req/s self-imposed rate limit. Batch driver: `scripts/enrich-nonprofits-propublica.ts` (`pnpm enrich:propublica`)
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

donor_discovery_geocache     -- SHARED, no org_id (migration 077)
- address_hash text PK       -- sha256 of the normalized input address string
- lat numeric, lng numeric
- formatted_address text, state text, county text, zip text
- cached_at timestamptz
```

**Address resolution:** the New Discovery wizard's radius-geography step resolves a user-typed address via `src/lib/donor-discovery/adapters/geocoding-adapter.ts` (Google Geocoding API, same platform key as the Places registry adapter, no per-org BYOK) before `donor_discovery_requests.geography` is populated with `{center:{lat,lng}, radius_mi}`. Cache-first against `donor_discovery_geocache`; rate limited to 10 req/s. `state`/`county`/`zip` are returned for on-screen confirmation only — they are not persisted onto the request itself.

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

*Status note (2026-07-10):* the §2B agent now has a dedicated, standalone implementation at `src/lib/donor-discovery/agents/enrichment-agent.ts` (`EnrichmentAgent.enrich(directoryId)`), alongside the inline enrichment already running inside `worker/dd-request-processor.ts`'s per-request pipeline. It extracts a superset of the `donor_prospect` web-extractor shape (adds `in_kind_history_signals` and `company_size_estimate`), always persists `skip_reason`/`error_reason` onto `donor_discovery_directory.enrichment` so failures are queryable, and emits a `donation_form_found` event (`donorDiscoveryEvents`, a Node `EventEmitter`) as the §7 AutoApply handoff signal — the event is emitted only; turning it into a `submission_queue` item for a specific org remains the explicit "Queue in AutoApply" operator action described in §7, not an automatic side effect, since directory records carry no `organization_id` to auto-target. A companion job handler (`src/worker/jobs/enrich-donor-prospect.ts`, job type `enrich_donor_prospect`) re-scores every `donor_discovery_prospects` row linked to the enriched directory record and is wired into `worker/queue-processor.ts`'s idle poll cycle (opportunistic re-enrichment of stale/never-enriched records with at least one linked prospect), rather than into `dd-request-processor.ts`, which keeps its existing request-scoped enrichment stage as the authoritative Phase 1/2 path.

**Phase 3 — Dashboard (1 queue, ~8 prompts):**
nav + routes · Overview · New Discovery wizard · Prospects table · Prospect detail · Badge/pipeline stages · Playwright specs

*Status note (2026-07-10):* all five pages built and reachable (nav, Overview, New Discovery wizard, Prospects table, Prospect detail) — see STATE_OF_THE_BUILD.md's per-page rebuild entries. **Not complete:** the New Discovery wizard's step-1 taxonomy picker calls `GET /api/donor-discovery/taxonomy/search`, which 500s in production today because `donor_discovery_taxonomy_aliases` (migration 075) is unapplied — see the "Phase 2-4 completion audit" entry in STATE_OF_THE_BUILD.md. Playwright specs cover only Overview/Prospects-list/Prospect-detail-not-found (3 smoke tests); the wizard and the Connectors page have zero E2E coverage.

**Phase 4 — Adapters & connectors (1 queue, ~7 prompts):**
TX license board adapter · land bank directory adapter · trade-association meta-adapter · Apollo + Hunter connectors on BYO-key infra · Connectors page

*Status note (2026-07-10, corrected):* TX license board adapter and land bank directory adapter are built (see §2A) but **not wired into the live request pipeline** — `worker/dd-request-processor.ts` only calls `google-places.ts`; both new adapters are reachable solely via their own standalone ingest scripts, neither of which has ever been run. Apollo + Hunter BYO-key connectors and the Connectors page are built and wired end-to-end (real HTTP calls, real encrypted-key infra reuse, real test-before-save CRUD) — but the connector-enrichment worker job writes `donor_discovery_prospects.enrichment_private` (migration 079), which is unapplied to production, so a live connector run would throw there today. Trade-association meta-adapter: still does not exist — confirmed via a fresh audit, not just carried forward from the note above. This phase should not be described as complete until (a) migrations 075-079 are applied to production and (b) a decision is made on whether the two new registry adapters get wired into `dd-request-processor.ts` or are formally deferred.

**Phase 5 — Loop closure (1 queue, ~5 prompts):**
AutoApply handoff · outcome feedback into scoring · weekly digest email · Scout report block on Overview

Each phase ends with governance-doc updates and a build+Playwright gate. Nothing in a later phase starts until the prior phase's gate passes.

---

## 8A. Grantmaker mode + scoring rubric (added 2026-08-22)

**Why this section exists:** the first real production Donor Discovery run
(`f4870e28-...`, 2026-08-21, Faith Foundation, TX, NTEE P/X/L, assets >= $1M)
enumerated 59 "foundations" that scored a suspiciously narrow 15-25 range,
then — discovered live during this session — got silently flattened to a
uniform **15/100 for all 59** by an unrelated opportunistic re-scoring job
four hours later (`score_donor_prospect`/`ScoringEngine`, scoring-engine.ts —
see below). Root cause was two compounding defects, both fixed 2026-08-22:

1. **BMF adapter filtered the wrong thing.** `nteeMajorGroups` (P/X/L) was
   applied directly against `foundation_directory.ntee_code` — the entity's
   own primary IRS classification. That finds organizations whose primary
   activity IS housing/human-services/religion delivery (i.e. legally a
   private foundation, but functionally an operating charity — a peer for
   the same grants FAITH Foundation applies for, not a funder of them), not
   organizations that *fund* those causes. `foundation_type` (`02`/`03`/`04`
   — private-foundation legal codes) covers 133,498 of 133,812 rows
   (99.8%) on its own, so it can't discriminate either. Fixed in
   `src/lib/donor-discovery/adapters/bmf-directory.ts`: grantmaker mode
   (default) filters structurally on `foundation_type IN ('02','03','04') OR
   ntee_code ILIKE 'T2%' OR ntee_code ILIKE 'T3%'` (NTEE's own "Private/
   Public Grantmaking Foundations" classification), THEN cause-matches the
   requested codes against what the foundation actually funds, tiered:
   `990pf_grants_data` (itemized 990-PF Part XV grants-paid recipient data —
   **does not exist in this schema**, confirmed 2026-08-22: no dedicated
   990-PF grants-paid/officers/application-procedures table, `officers` is
   100% empty on `foundation_directory`, `intelligence_grantmaker_profiles`
   — this doc's own KB8 table — has 0 rows) → `ntee_code_direct` (the
   foundation's own NTEE code already starts with the requested cause
   letter) → `name_keyword_match` (keyword match on legal name, for T-coded
   "pure philanthropy" foundations with no cause signal in their own NTEE
   code). The method used is recorded per-prospect as
   `enrichment.match_basis`. Pre-2026-08-22 behavior (cause codes matched
   directly, no structural filter) is preserved behind
   `geography.operating_nonprofits: true`.

2. **Two independent scorers wrote the same columns with no coordination.**
   `worker/dd-request-processor.ts`'s synchronous per-request scoring stage
   uses the deterministic `scoring.ts` (`scoreProspect`); a separate
   opportunistic worker job (`score-donor-prospect.ts`, `ScoringEngine` in
   `scoring-engine.ts`) re-scores any never-scored prospect with its own
   7-signal weight scheme and a Claude-generated rationale. For a BMF-native
   prospect with no website on file, `ScoringEngine` has nothing to
   contribute beyond `foundationLinkageFound` (its other 6 signals all need
   web-enrichment fields), yet it unconditionally overwrote the richer
   deterministic score — confirmed live: all 59 `f4870e28` prospects'
   `scored_at` stamps cluster ~4 hours after the request completed,
   identical flat score of 15. Fixed: `claimNextScoreDonorProspectJob` now
   only claims prospects whose linked directory record has a `website` —
   nothing for `ScoringEngine` to add otherwise, no more clobbering.

### Scoring rubric (`src/lib/donor-discovery/scoring.ts`, `DEFAULT_SCORING_WEIGHTS`, sums to 100)

Rebalanced 2026-08-22 to add four signals that fire from BMF data alone —
grantmaker-mode prospects have zero web enrichment by construction (no
website on file for most of `foundation_directory`), so the original six
weights (all but `linkedFoundation`/`geoMatch` require web-enrichment jsonb)
produced almost no spread. The original `geoMatch` also had a live bug:
`bmf-directory.ts`'s `hqAddress()` omitted zip, and `isGeoMatch`'s
`extractStateFromAddress()` regex required a trailing 5-digit zip to extract
a state — so `geoMatch` silently never fired for any BMF-sourced record even
when the record was obviously within the requested state (that WAS the
enumeration filter). Both fixed: `hqAddress()` now includes zip when
available; the regex now also accepts a bare trailing state code.

| Signal | Weight | Fires from | Notes |
|---|---|---|---|
| `givingProgram` | 15 | web enrichment | `has_giving_program` |
| `donationForm` | 15 | web enrichment | `has_donation_form` |
| `inKindSignals` | 10 | web enrichment | keyword match on `giving_focus_areas` |
| `linkedFoundation` | 10 | BMF (always 1.0 for BMF-native rows) | scaled by `linkage_confidence` |
| `geoMatch` | 10 | BMF or web (fixed 2026-08-22) | within the *requested* geography |
| `sizeAppropriate` | 5 | BMF (needs org `annual_budget` + linked giving capacity) | ratio in [0.02, 200] |
| `assetSize` **(new)** | 15 | BMF (`enrichment.asset_amount`) | tiered: <$2M=0.25, $2-10M=0.5, $10-50M=0.75, >=$50M=1.0 |
| `grantmakerType` **(new)** | 10 | BMF (`is_grantmaker_ntee`/`is_grantmaker_foundation_type`) | 1.0 if NTEE T2x/T3x-confirmed, 0.5 if foundation_type-only |
| `geoProximityToOrg` **(new)** | 5 | BMF (org `city`/`state` vs. prospect `hq_address`) | 1.0 same city, 0.5 same state — distinct from `geoMatch`, which only checks the *requested* geography, not proximity to the org itself |
| `matchBasisQuality` **(new)** | 5 | BMF (`enrichment.match_basis`) | 1.0 `ntee_code_direct`/`990pf_grants_data`, 0.5 `name_keyword_match`, 0 `operating_nonprofit_mode` |

**Worked example** (real shape from the `f4870e28` re-run): a $200M,
NTEE-T-confirmed, directly-cause-matched foundation headquartered in the
org's own city scores `linkedFoundation`(10) + `geoMatch`(10) +
`assetSize`(15) + `grantmakerType`(10) + `geoProximityToOrg`(5) +
`matchBasisQuality`(5) = **55**, versus a $1.1M, foundation_type-only,
keyword-matched, out-of-state foundation at `linkedFoundation`(10) +
`assetSize`(3.75) + `grantmakerType`(5) + `matchBasisQuality`(2.5) = **~21**
— real, ranked spread from BMF data alone, no web enrichment required.

## 9. Open Decisions (Reid)

1. Confirm connector vendors for V1 (Apollo.io? Hunter.io? others?)
2. Google Places API budget ceiling per month (drives enumeration throttling defaults)
3. Pricing posture: included in existing tiers vs. premium add-on (affects feature-flag design in Phase 1)
4. Directory seeding: import the 298K nonprofit prospect CSV's *corporate* records into the shared directory at Phase 1, or keep that dataset exclusively in Sales Outreach?
