# Benavora Universal Scraper — Ground-Up Architecture PRD
## Status: CANONICAL — replaces stealth-engine.ts / foundation-scraper.ts / nonprofit-scraper.ts
## Date: July 28, 2026
## Supersedes: STEALTH_SCRAPER_ELITE_PRD.md (repair-oriented, abandoned per direction)

---

## 1. Problem Statement

The existing scraper is single-purpose: hard-coded to IRS 990 XML parsing and foundation/
nonprofit contact extraction, using brittle regex/tag-matching that breaks whenever a
source's format changes (already proven twice tonight — IRS's URL scheme changed, and the
XML viewer rendering broke tag extraction). This does not generalize to "scrape anything
by keyword."

## 2. Goals
- A single service that accepts: a keyword/topic, an optional target-domain constraint,
  and a desired output schema — and returns structured data, regardless of source format
- Reuse of the elite browser/stealth stack (real engineering problem, correctly scoped)
- Replace brittle per-site parsers with schema-flexible extraction

## 3. Architecture

### 3.1 Discovery Layer
Given a keyword, find candidate URLs via:
- Search engine query (Google/Bing/DuckDuckGo, rotating across all three to reduce
  single-engine rate-limiting — this is a real mitigation, not proxy infrastructure)
- Direct domain crawl (if a target domain is specified instead of open search)
- Sitemap.xml parsing where available (fast, structured, zero detection risk — an
  underused free source of URLs most scrapers skip)

### 3.2 Fetch Layer (the "elite" stack — unchanged from prior spec, still correct)
- **Camoufox** — patched Firefox, engine-level fingerprint resistance
- **rebrowser-patches** — CDP leak patching
- **fingerprint-suite** — internally-consistent fingerprint generation
- **ghost-cursor** — human-like interaction paths
- **Crawlee** — SessionPool, adaptive retry, autoscaling request queue (already a
  dependency, now the primary orchestration layer instead of hand-rolled loops)

### 3.3 Extraction Layer — the actual generality mechanism
After fetch, page content (readability-extracted main text, not raw HTML) is sent to
Claude with:
- The original keyword/intent
- A caller-specified JSON schema describing desired output fields
Claude returns structured JSON matching that schema, or `null` fields where data isn't
present on the page (not fabricated). This replaces per-site regex parsers entirely —
a new "scrape target type" requires a new schema definition, not new parsing code.

### 3.4 Job/Result Model (generic, not domain-specific)
```sql
CREATE TABLE scrape_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL,
  target_domain text,
  output_schema jsonb NOT NULL,
  status text DEFAULT 'pending',
  urls_discovered integer DEFAULT 0,
  urls_processed integer DEFAULT 0,
  results_found integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE scrape_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES scrape_jobs(id),
  source_url text NOT NULL,
  extracted_data jsonb NOT NULL,
  confidence text,
  fetched_at timestamptz DEFAULT now(),
  fetch_error text
);
```

### 3.5 CLI / API Entry Point
```
pnpm scrape:universal --keyword "veteran housing nonprofits Texas" \
  --schema '{"org_name":"string","website":"string","email":"string","phone":"string"}' \
  --limit 100
```
Also exposed as an internal API route for the platform itself to trigger jobs
programmatically (e.g. Donor Discovery requesting a scrape for a new keyword).

## 4. Existing Foundation/Nonprofit Scrapers — Disposition
Not deleted. Re-platformed as two pre-configured `scrape_jobs` templates on top of the
new universal engine (IRS 990 index discovery + foundation-schema extraction becomes one
template; nonprofit contact extraction becomes another). This preserves tonight's real,
working IRS-990 fix (batch ZIP handling, `fetchRaw` vs `fetchPage`) as the discovery-layer
logic for that specific template — that part was correct engineering, not shell garbage,
and doesn't need to be rebuilt, only re-hosted under the general architecture.

## 5. Non-Goals (still true, still honest)
- Cannot defeat enterprise-grade WAFs (Cloudflare Enterprise, DataDome, PerimeterX,
  Kasada) — no free/open-source stack does this reliably. Not needed for the actual
  targets (foundation/nonprofit/general web content, not e-commerce/finance platforms).
- Not a residential-proxy service — still not required for these targets.

## 6. Success Criteria
- A single keyword + schema produces real, verified structured data for at least 3
  different, previously-untested domains (not just IRS/foundation sites) — proves
  generality, not just re-skinned single-purpose logic
- Every build step verified via live database query of real results, never via
  compile-pass or terminal-output alone
