# BENAVORA — Session Handoff
## Date: July 18, 2026
## For: Next Claude session in Benavora project chat

---

## Current State

### Running Processes (DO NOT INTERRUPT)
Two PowerShell windows are running enrichment scripts:

Window 1: `npx tsx scripts/enrich-foundations-propublica.ts`
- Enriching 133,812 foundation_directory records from ProPublica API
- At ~77,400/133,812 (~58%) as of handoff
- Estimated ~10 hours remaining
- Do NOT close this window

Window 2: `npx tsx scripts/enrich-nonprofits-bmf-propublica.ts`
- Enriching 1,978,526 nonprofits table records from ProPublica API
- Just launched, at ~0%
- Will run for 9-10 days at 400ms/record
- Consider moving to Railway worker for sustained execution

### Data Counts (verified in Supabase)
- nonprofits table: 1,978,526 records (IRS BMF, all 51 states, 0 failures)
- foundation_directory: 133,812 records
- intelligence_funded_proposals: 31 records (seeded)
- knowledge_patterns: 30 records (seeded)
- opportunity_probability_scores: 500 records
- organizational_digital_twins: 10 orgs (Faith Foundation at 60-70%)
- discovery_matches: ~500 (Federal Register)

---

## Immediate Blockers Requiring Fixes

### 1. enrich-990-xml.ts is broken (IRS 403)
The script at `scripts/enrich-990-xml.ts` tries to fetch individual XML files from IRS.gov and gets HTTP 403 on every request. The IRS blocked direct XML fetching.

**Fix needed:** Rewrite to download ZIP bundles instead:
- ZIP URLs: `https://apps.irs.gov/pub/epostcard/990/xml/2023/2023_TEOS_XML_01A.zip` through `12A.zip`
- Download each ZIP to a temp folder
- Extract all XML files
- Parse each XML using fast-xml-parser (already installed)
- Update nonprofits table with extracted fields
- Delete temp files after each ZIP

The index CSV works fine: `https://apps.irs.gov/pub/epostcard/990/xml/2023/index_2023.csv` (returns 200)
The CSV columns are: ObjectId, IsElectronic, EIN, TaxPeriod, Year, OrgName, FormType, ObjectId2, LastUpdated

### 2. Duplicate Faith Foundation records
Two records exist in organizations table for Faith Foundation. Manual dedup needed in Supabase dashboard at:
https://supabase.com/dashboard/project/vbjplpquqxxfbpazyalt/table-editor

### 3. DATAOCEAN backup NEVER done
enrichment-output/ folder has never been backed up to D:\. Critical risk — any script rerun overwrites output files.

---

## Supabase Schema — nonprofits table (current columns)
id, ein, name, city, state, zip, ntee_code, subsection_code, foundation_type, ruling_date,
revenue_amount, asset_amount, income_amount, status, created_at, updated_at,
website, phone, officer_name, officer_title, officer_email, mission, employee_count,
linkedin_url, facebook_url, twitter_url, instagram_url, staff_contacts, contact_emails,
last_enriched_at, enrichment_tier

---

## Package.json Scripts (data pipeline)
```
pnpm ingest:bmf              — IRS BMF import (COMPLETE — do not rerun without DATAOCEAN backup)
pnpm enrich:propublica       — ProPublica foundation_directory enrichment (RUNNING)
pnpm enrich:nonprofits-pp    — ProPublica nonprofits table enrichment (RUNNING)
pnpm enrich:990xml           — IRS 990 XML enrichment (BLOCKED — needs ZIP rewrite)
pnpm enrich:nonprofit-websites — Website contact scraper (READY — run after websites populated)
pnpm score:opportunities     — Probability score all opportunities (COMPLETE)
pnpm score:eligibility       — Eligibility score all opportunities (NOT YET RUN)
pnpm build:twins             — Build digital twins for all orgs (COMPLETE)
pnpm seed:intelligence       — Seed Intelligence Library corpus (COMPLETE)
pnpm seed:patterns           — Seed knowledge patterns (COMPLETE)
pnpm poll:federal            — Poll federal grant sources (COMPLETE)
pnpm acquire:prospects       — Acquire corporate prospects via Google Places (NOT YET RUN)
pnpm populate:all            — Master orchestration script (NOT YET RUN)
```

---

## Governance Documents (all in repo root)
All 14 v2.0 governance docs are in C:\Users\manag\Documents\benavora\
- BLUEPRINT_v2.md (master architecture)
- SCHEMA_REGISTRY_v2.md (all 67 tables)
- FEATURE_REGISTRY_v2.md (186 features)
- INTERACTION_MAPS_v2.md (60+ user flows)
- PRD_v2.md (18 pillars, user stories)
- AGENTS_v2.md (30 agents)
- PLATFORM_VISION_ARCHITECTURE.md (14 net-new pillars)
- CORPORATE_INTELLIGENCE_ARCHITECTURE.md
- STANDING_DIRECTIVES.md
- TESTING_v2.md
- FORGE_CANONICAL_INSTRUCTIONS.md
- WORKER_ARCHITECTURE_v2.md
- STATE_OF_THE_BUILD.md
- SESSION_STATE.md

---

## Next Build Priorities

### Tonight's FORGE Queue (Platform Vision Phase 2)
- Autonomous Relationship Builder (Pillar 4)
- Predictive Funding Forecast (Pillar 11)
- Philanthropic Intelligence Graph Phase 1 (Pillar 1)

### UI Redesign (CC sessions, one component at a time)
- FlightPathHUD illustration positioning (hero banner)
- Opportunities page — probability badges + sort
- All remaining pages need inline style={{}} treatment

### Data Pipeline (after enrichments complete)
- Fix enrich-990-xml.ts (ZIP approach)
- Run pnpm score:eligibility
- Run pnpm acquire:prospects
- Consider Railway worker for sustained nonprofit ProPublica enrichment

### Critical Human Actions Required
1. Back up enrichment-output/ to D:\ (DATAOCEAN)
2. Dedup Faith Foundation org records in Supabase
3. Enable GitHub 2FA (required by August 15, 2026)

---

## FORGE Launch Command
```powershell
cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; $env:ANTHROPIC_API_KEY=$null; powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0
```

## Vercel Deploy (always manual)
```powershell
cd "C:\Users\manag\Documents\benavora"; npx vercel deploy --prod
```

## End of Session Governance Deployment
```powershell
$docs = @("BLUEPRINT_v2.md","SCHEMA_REGISTRY_v2.md","FEATURE_REGISTRY_v2.md","INTERACTION_MAPS_v2.md","PRD_v2.md","AGENTS_v2.md","PLATFORM_VISION_ARCHITECTURE.md","CORPORATE_INTELLIGENCE_ARCHITECTURE.md","STANDING_DIRECTIVES.md","TESTING_v2.md","FORGE_CANONICAL_INSTRUCTIONS.md","WORKER_ARCHITECTURE_v2.md","STATE_OF_THE_BUILD.md","SESSION_STATE.md")
$src = "C:\Users\manag\Downloads\Recent Downloads"
$repo = "C:\Users\manag\Documents\benavora"
$forge = "C:\Users\manag\Documents\FORGE\projects\benavora"
foreach ($f in $docs) { Copy-Item "$src\$f" "$repo\$f" -Force; Copy-Item "$src\$f" "$forge\$f" -Force }
cd $repo; git add -A; git commit -m "docs: governance update"; git push origin main
```
